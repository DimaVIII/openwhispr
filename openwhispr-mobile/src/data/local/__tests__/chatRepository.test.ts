import { sql } from 'drizzle-orm';
import { createMemoryChatRepository } from './testDb';

describe('LocalChatRepository', () => {
  let now: number;

  beforeEach(() => {
    now = 1_000;
    // Each call advances the clock so ordering never depends on two writes landing in one ms.
    jest.spyOn(Date, 'now').mockImplementation(() => (now += 10));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists conversations newest first with the last message as preview', () => {
    const { repo } = createMemoryChatRepository();
    const a = repo.createConversation('A');
    const b = repo.createConversation('B');
    repo.appendMessage({ conversationId: a.id, role: 'user', text: 'hello   there' });

    const list = repo.listConversations();

    expect(list.map((conversation) => conversation.id)).toEqual([a.id, b.id]);
    expect(list[0].preview).toBe('hello there');
    expect(list[1].preview).toBe('');
  });

  it('cuts the preview to 120 characters and honors the limit', () => {
    const { repo } = createMemoryChatRepository();
    const a = repo.createConversation('A');
    repo.createConversation('B');
    repo.appendMessage({ conversationId: a.id, role: 'user', text: 'x'.repeat(300) });

    const list = repo.listConversations(1);

    expect(list).toHaveLength(1);
    expect(list[0].preview).toHaveLength(120);
  });

  it('round-trips steps and sources', () => {
    const { repo } = createMemoryChatRepository();
    const conversation = repo.createConversation('Pricing');
    const steps = [
      {
        id: 'search' as const,
        status: 'done' as const,
        label: 'Searched your notes',
        detail: '2 notes match',
      },
    ];
    const sources = [{ noteId: 7, title: 'Pricing call' }];

    const saved = repo.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      text: 'Here you go',
      steps,
      sources,
    });

    expect(saved.steps).toEqual(steps);
    expect(saved.sources).toEqual(sources);
    expect(repo.getMessages(conversation.id)).toEqual([saved]);
  });

  it('bumps the conversation updatedAt when a message is appended', () => {
    const { repo } = createMemoryChatRepository();
    const conversation = repo.createConversation('A');
    const message = repo.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'hi',
    });

    expect(repo.getConversation(conversation.id)?.updatedAt).toBe(message.createdAt);
  });

  it('reads malformed steps_json as an empty list', () => {
    const { repo, db } = createMemoryChatRepository();
    const conversation = repo.createConversation('A');
    const message = repo.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      text: 'hi',
      steps: [{ id: 'read', status: 'done', label: 'Read a note' }],
    });
    db.run(
      sql`UPDATE chat_messages SET steps_json = '{', sources_json = NULL WHERE id = ${message.id}`,
    );

    const [reloaded] = repo.getMessages(conversation.id);

    expect(reloaded.steps).toEqual([]);
    expect(reloaded.sources).toEqual([]);
  });

  it('deleteConversation removes its messages', () => {
    const { repo } = createMemoryChatRepository();
    const doomed = repo.createConversation('Doomed');
    const kept = repo.createConversation('Kept');
    repo.appendMessage({ conversationId: doomed.id, role: 'user', text: 'bye' });
    repo.appendMessage({ conversationId: kept.id, role: 'user', text: 'stay' });

    repo.deleteConversation(doomed.id);

    expect(repo.getMessages(doomed.id)).toEqual([]);
    expect(repo.getConversation(doomed.id)).toBeNull();
    expect(repo.getMessages(kept.id)).toHaveLength(1);
  });

  it('deleteMessage removes one message and returns the rest oldest first', () => {
    const { repo } = createMemoryChatRepository();
    const conversation = repo.createConversation('A');
    const first = repo.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'one',
    });
    const second = repo.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      text: 'two',
    });
    const third = repo.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'three',
    });

    repo.deleteMessage(second.id);

    expect(repo.getMessages(conversation.id).map((message) => message.id)).toEqual([
      first.id,
      third.id,
    ]);
  });

  it('clearAll empties both tables', () => {
    const { repo } = createMemoryChatRepository();
    const conversation = repo.createConversation('A');
    repo.appendMessage({ conversationId: conversation.id, role: 'user', text: 'hi' });

    repo.clearAll();

    expect(repo.listConversations()).toEqual([]);
    expect(repo.getMessages(conversation.id)).toEqual([]);
  });
});
