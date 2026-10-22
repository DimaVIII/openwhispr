import { chatMessages } from '@/db/schema';
import type { LocalChatRepository } from '@/data/local/chatRepository';
import { createMemoryChatRepository, type TestDb } from '@/data/local/__tests__/testDb';
import type { ChatTurnInput, ChatTurnResult } from '@/lib/chat/runChatTurn';

let mockRepo: LocalChatRepository;
jest.mock('@/data', () => ({
  get chatRepository() {
    return mockRepo;
  },
}));
jest.mock('@/lib/chat/runChatTurn', () => ({ runChatTurn: jest.fn() }));

import { runChatTurn } from '@/lib/chat/runChatTurn';
import { clearChatHistory } from '@/lib/chat/chatHistory';
import { useChatStore } from '@/store/useChatStore';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const answer = (text: string): ChatTurnResult => ({
  text,
  steps: [{ id: 'write', status: 'done', label: 'Wrote your answer' }],
  sources: [{ noteId: 3, title: 'Pricing call' }],
});

const abortError = (): Error => {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

const mockRun = jest.mocked(runChatTurn);
const turnInput = (call: number): ChatTurnInput => mockRun.mock.calls[call][0];
const sendOptions = { allowCloudFallback: false };

let db: TestDb;

beforeEach(() => {
  ({ repo: mockRepo, db } = createMemoryChatRepository());
  mockRun.mockReset();
  useChatStore.getState().reset();
});

describe('useChatStore', () => {
  it('creates a conversation titled from the first question', async () => {
    mockRun.mockResolvedValueOnce(answer('ok'));
    const question = `  ${'x'.repeat(30)}\n\n ${'y'.repeat(39)}  `;

    const sent = useChatStore.getState().send(question, { conversationId: null, ...sendOptions });
    await sent?.done;

    const conversation = mockRepo.getConversation(sent?.conversationId ?? '');
    expect(conversation?.title).toHaveLength(61);
    expect(conversation?.title).toBe(`${'x'.repeat(30)} ${'y'.repeat(29)}…`);
    expect(useChatStore.getState().conversations.map(({ id }) => id)).toEqual([conversation?.id]);
  });

  it('keeps a short question as the whole title', async () => {
    mockRun.mockResolvedValueOnce(answer('ok'));

    const sent = useChatStore.getState().send('  What did   we decide? ', {
      conversationId: null,
      ...sendOptions,
    });
    await sent?.done;

    expect(mockRepo.getConversation(sent?.conversationId ?? '')?.title).toBe('What did we decide?');
  });

  it('cuts a title by character so an emoji is never split', async () => {
    mockRun.mockResolvedValueOnce(answer('ok'));

    const sent = useChatStore.getState().send(`${'x'.repeat(59)}😀😀`, {
      conversationId: null,
      ...sendOptions,
    });
    await sent?.done;

    expect(mockRepo.getConversation(sent?.conversationId ?? '')?.title).toBe(
      `${'x'.repeat(59)}😀…`,
    );
  });

  it('refuses a blank question', () => {
    expect(
      useChatStore.getState().send('   ', { conversationId: null, ...sendOptions }),
    ).toBeNull();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockRepo.listConversations()).toEqual([]);
  });

  it('refuses a second send while one is pending', () => {
    mockRun.mockReturnValueOnce(deferred<ChatTurnResult>().promise);
    const other = mockRepo.createConversation('Other');

    const first = useChatStore.getState().send('first', { conversationId: null, ...sendOptions });
    const second = useChatStore.getState().send('second', {
      conversationId: other.id,
      ...sendOptions,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRepo.getMessages(other.id)).toEqual([]);
    expect(useChatStore.getState().pending).toMatchObject({
      conversationId: first?.conversationId,
      phase: 'working',
    });
  });

  it('passes earlier messages as history and records steps while the turn is current', async () => {
    const conversation = mockRepo.createConversation('Pricing');
    const earlier = [
      mockRepo.appendMessage({ conversationId: conversation.id, role: 'user', text: 'q1' }),
      mockRepo.appendMessage({ conversationId: conversation.id, role: 'assistant', text: 'a1' }),
    ];
    const turn = deferred<ChatTurnResult>();
    mockRun.mockReturnValueOnce(turn.promise);
    useChatStore.getState().openConversation(conversation.id);

    const sent = useChatStore.getState().send('q2', {
      conversationId: conversation.id,
      allowCloudFallback: true,
    });
    const input = turnInput(0);
    input.onSteps([{ id: 'search', status: 'active', label: 'Searching your notes…' }]);

    expect(input.question).toBe('q2');
    expect(input.history).toEqual(earlier);
    expect(input.allowCloudFallback).toBe(true);
    expect(useChatStore.getState().messages.map(({ text }) => text)).toEqual(['q1', 'a1', 'q2']);
    expect(useChatStore.getState().pending?.steps).toEqual([
      { id: 'search', status: 'active', label: 'Searching your notes…' },
    ]);

    turn.resolve(answer('a2'));
    await sent?.done;

    const last = useChatStore.getState().messages.at(-1);
    expect(last).toMatchObject({ role: 'assistant', text: 'a2', sources: answer('a2').sources });
    expect(useChatStore.getState().pending).toBeNull();
    expect(useChatStore.getState().conversations[0].preview).toBe('a2');
  });

  it('saves the answer into the conversation that asked', async () => {
    const other = mockRepo.createConversation('B');
    const turn = deferred<ChatTurnResult>();
    mockRun.mockReturnValueOnce(turn.promise);

    const sent = useChatStore.getState().send('in A', { conversationId: null, ...sendOptions });
    useChatStore.getState().openConversation(other.id);
    turn.resolve(answer('answer for A'));
    await sent?.done;

    const askedIn = mockRepo.getMessages(sent?.conversationId ?? '');
    expect(askedIn.at(-1)).toMatchObject({ role: 'assistant', text: 'answer for A' });
    expect(useChatStore.getState().activeConversationId).toBe(other.id);
    expect(useChatStore.getState().messages.map(({ text }) => text)).not.toContain('answer for A');
    expect(useChatStore.getState().conversations[0]).toMatchObject({
      id: sent?.conversationId,
      preview: 'answer for A',
    });
  });

  it('drops a late answer after reset', async () => {
    const turn = deferred<ChatTurnResult>();
    mockRun.mockReturnValueOnce(turn.promise);

    const sent = useChatStore.getState().send('question', {
      conversationId: null,
      ...sendOptions,
    });
    const input = turnInput(0);
    clearChatHistory();
    input.onSteps([{ id: 'write', status: 'active', label: 'Writing your answer…' }]);
    turn.resolve(answer('too late'));
    await sent?.done;

    expect(input.signal.aborted).toBe(true);
    expect(mockRepo.listConversations()).toEqual([]);
    expect(db.select().from(chatMessages).all()).toEqual([]);
    expect(useChatStore.getState()).toMatchObject({
      conversations: [],
      activeConversationId: null,
      messages: [],
      pending: null,
      failure: null,
    });
  });

  it('records a failure and retries without a second user message', async () => {
    const conversation = mockRepo.createConversation('Pricing');
    const earlier = [
      mockRepo.appendMessage({ conversationId: conversation.id, role: 'user', text: 'q1' }),
      mockRepo.appendMessage({ conversationId: conversation.id, role: 'assistant', text: 'a1' }),
    ];
    mockRun.mockRejectedValueOnce(new Error('The model is unavailable.'));
    mockRun.mockResolvedValueOnce(answer('retried answer'));

    const sent = useChatStore.getState().send('question', {
      conversationId: conversation.id,
      ...sendOptions,
    });
    await sent?.done;
    const conversationId = conversation.id;
    const userMessage = mockRepo.getMessages(conversationId)[2];

    expect(useChatStore.getState().failure).toEqual({
      conversationId,
      messageId: userMessage.id,
      question: 'question',
      message: 'Check your connection and try again.',
    });
    expect(useChatStore.getState().pending).toBeNull();

    await useChatStore.getState().retry({ allowCloudFallback: true });

    expect(turnInput(0).history).toEqual(earlier);
    expect(turnInput(1)).toMatchObject({ question: 'question', allowCloudFallback: true });
    expect(turnInput(1).history).toEqual(earlier);
    expect(mockRepo.getMessages(conversationId).map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1' },
      { role: 'user', text: 'question' },
      { role: 'assistant', text: 'retried answer' },
    ]);
    expect(useChatStore.getState().failure).toBeNull();
  });

  it('falls back to a connection message when the error has none', async () => {
    mockRun.mockRejectedValueOnce(new Error(''));

    const sent = useChatStore.getState().send('question', {
      conversationId: null,
      ...sendOptions,
    });
    await sent?.done;

    expect(useChatStore.getState().failure?.message).toBe('Check your connection and try again.');
  });

  it('keeps a failure through sends elsewhere and clears it on a send to its conversation', async () => {
    const other = mockRepo.createConversation('B');
    mockRun.mockRejectedValueOnce(new Error('boom'));
    mockRun.mockResolvedValue(answer('ok'));

    const sent = useChatStore.getState().send('question', {
      conversationId: null,
      ...sendOptions,
    });
    await sent?.done;
    const failedId = sent?.conversationId ?? '';
    useChatStore.getState().openConversation(other.id);

    expect(useChatStore.getState().failure?.conversationId).toBe(failedId);

    await useChatStore.getState().send('in B', { conversationId: other.id, ...sendOptions })?.done;
    await useChatStore.getState().send('a new chat', { conversationId: null, ...sendOptions })
      ?.done;

    expect(useChatStore.getState().failure?.conversationId).toBe(failedId);

    const again = useChatStore.getState().send('again', {
      conversationId: failedId,
      ...sendOptions,
    });

    expect(useChatStore.getState().failure).toBeNull();
    await again?.done;
  });

  it('hands the failed question back for editing and deletes it', async () => {
    mockRun.mockRejectedValueOnce(new Error('boom'));
    const conversation = mockRepo.createConversation('A');
    useChatStore.getState().openConversation(conversation.id);

    const sent = useChatStore.getState().send('fix me', {
      conversationId: conversation.id,
      ...sendOptions,
    });
    await sent?.done;

    expect(useChatStore.getState().editFailedQuestion()).toBe('fix me');
    expect(mockRepo.getMessages(conversation.id)).toEqual([]);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().failure).toBeNull();
    expect(useChatStore.getState().editFailedQuestion()).toBeNull();
  });

  it('deletes a conversation that editing the failed question leaves empty', async () => {
    mockRun.mockRejectedValueOnce(new Error('boom'));

    const sent = useChatStore.getState().send('fix me', {
      conversationId: null,
      ...sendOptions,
    });
    const conversationId = sent?.conversationId ?? '';
    useChatStore.getState().openConversation(conversationId);
    await sent?.done;

    expect(useChatStore.getState().editFailedQuestion()).toBe('fix me');
    expect(mockRepo.getConversation(conversationId)).toBeNull();
    expect(useChatStore.getState().conversations).toEqual([]);
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });

  it('keeps a conversation that still has messages after editing the failed question', async () => {
    const conversation = mockRepo.createConversation('A');
    mockRepo.appendMessage({ conversationId: conversation.id, role: 'user', text: 'q1' });
    mockRepo.appendMessage({ conversationId: conversation.id, role: 'assistant', text: 'a1' });
    mockRun.mockRejectedValueOnce(new Error('boom'));

    await useChatStore.getState().send('fix me', {
      conversationId: conversation.id,
      ...sendOptions,
    })?.done;

    expect(useChatStore.getState().editFailedQuestion()).toBe('fix me');
    expect(mockRepo.getConversation(conversation.id)).not.toBeNull();
    expect(mockRepo.getMessages(conversation.id).map(({ text }) => text)).toEqual(['q1', 'a1']);
  });

  it('cancel keeps the question and clears pending', async () => {
    const turn = deferred<ChatTurnResult>();
    mockRun.mockReturnValueOnce(turn.promise);

    const sent = useChatStore.getState().send('question', {
      conversationId: null,
      ...sendOptions,
    });
    useChatStore.getState().cancel();

    expect(turnInput(0).signal.aborted).toBe(true);
    expect(useChatStore.getState().pending).toBeNull();

    turn.reject(abortError());
    await sent?.done;

    expect(mockRepo.getMessages(sent?.conversationId ?? '').map(({ text }) => text)).toEqual([
      'question',
    ]);
    expect(useChatStore.getState().failure).toBeNull();
    expect(useChatStore.getState().pending).toBeNull();
  });

  it('records a failure when a current turn rejects with an AbortError', async () => {
    mockRun.mockRejectedValueOnce(abortError());

    const sent = useChatStore.getState().send('question', {
      conversationId: null,
      ...sendOptions,
    });
    await sent?.done;

    expect(useChatStore.getState().failure).toMatchObject({
      conversationId: sent?.conversationId,
      question: 'question',
      message: 'Check your connection and try again.',
    });
    expect(useChatStore.getState().pending).toBeNull();
  });

  it('ignores steps from a cancelled turn after a new one starts', () => {
    mockRun.mockReturnValue(deferred<ChatTurnResult>().promise);
    const turnTwoSteps = [
      { id: 'search' as const, status: 'active' as const, label: 'Searching…' },
    ];

    useChatStore.getState().send('first', { conversationId: null, ...sendOptions });
    useChatStore.getState().cancel();
    useChatStore.getState().send('second', { conversationId: null, ...sendOptions });
    turnInput(1).onSteps(turnTwoSteps);
    turnInput(0).onSteps([{ id: 'write', status: 'active', label: 'Writing your answer…' }]);

    expect(useChatStore.getState().pending?.steps).toEqual(turnTwoSteps);
  });

  it('ignores a late rejection after reset', async () => {
    const turn = deferred<ChatTurnResult>();
    mockRun.mockReturnValueOnce(turn.promise);

    const sent = useChatStore.getState().send('question', {
      conversationId: null,
      ...sendOptions,
    });
    clearChatHistory();
    turn.reject(new Error('The model is unavailable.'));
    await sent?.done;

    expect(useChatStore.getState().failure).toBeNull();
    expect(useChatStore.getState().pending).toBeNull();
    expect(db.select().from(chatMessages).all()).toEqual([]);
  });

  it('refuses to send into a deleted conversation', () => {
    const conversation = mockRepo.createConversation('A');

    expect(useChatStore.getState().beginTranscribing(conversation.id)).toBe(true);
    useChatStore.getState().deleteConversation(conversation.id);
    const sent = useChatStore.getState().send('spoken', {
      conversationId: conversation.id,
      ...sendOptions,
    });

    expect(sent).toBeNull();
    expect(db.select().from(chatMessages).all()).toEqual([]);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('holds one transcribing slot and lets send take it over', async () => {
    mockRun.mockResolvedValueOnce(answer('ok'));

    expect(useChatStore.getState().beginTranscribing(null)).toBe(true);
    expect(useChatStore.getState().beginTranscribing(null)).toBe(false);
    expect(useChatStore.getState().pending).toMatchObject({
      conversationId: null,
      phase: 'transcribing',
    });

    const sent = useChatStore.getState().send('spoken', { conversationId: null, ...sendOptions });

    expect(sent).not.toBeNull();
    expect(useChatStore.getState().pending?.phase).toBe('working');
    useChatStore.getState().endTranscribing();
    expect(useChatStore.getState().pending?.phase).toBe('working');

    await sent?.done;
    useChatStore.getState().beginTranscribing(sent?.conversationId ?? null);
    useChatStore.getState().endTranscribing();
    expect(useChatStore.getState().pending).toBeNull();
  });

  it('deletes a conversation and cancels its running turn', async () => {
    const turn = deferred<ChatTurnResult>();
    mockRun.mockReturnValueOnce(turn.promise);

    const sent = useChatStore.getState().send('question', {
      conversationId: null,
      ...sendOptions,
    });
    const conversationId = sent?.conversationId ?? '';
    useChatStore.getState().openConversation(conversationId);
    useChatStore.getState().deleteConversation(conversationId);
    turn.resolve(answer('too late'));
    await sent?.done;

    expect(turnInput(0).signal.aborted).toBe(true);
    expect(db.select().from(chatMessages).all()).toEqual([]);
    expect(useChatStore.getState()).toMatchObject({
      conversations: [],
      activeConversationId: null,
      messages: [],
      pending: null,
    });
  });
});
