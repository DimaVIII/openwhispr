import type { GoogleCalendarAccount, GoogleCalendarEvent, Note } from '@/data';
import { LocalReasoningError } from '@/lib/localReasoning';
import {
  createDefaultChatTurnDeps,
  runChatTurn,
  type ChatTurnDeps,
  type ChatTurnInput,
} from '../runChatTurn';
import type { ChatMessage, ChatStep } from '../types';

const mockGetNoteById = jest.fn();
jest.mock('@/data', () => ({ notesRepository: { getNoteById: mockGetNoteById } }));

// Built with local-time constructors so assertions don't depend on the machine's timezone.
const NOW = new Date(2026, 9, 22, 9, 0, 0);

const formatTime = (date: Date): string =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const makeNote = (overrides: Partial<Note> & { id: number }): Note =>
  ({
    title: 'Untitled',
    content: '',
    enhancedContent: null,
    isPrivate: 0,
    updatedAt: new Date(2026, 9, 20, 12, 0, 0).toISOString(),
    ...overrides,
  }) as Note;

const makeEvent = (
  summary: string | null,
  start: Date,
  end: Date,
  allDay = 0,
): GoogleCalendarEvent =>
  ({
    id: 1,
    summary,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay,
  }) as GoogleCalendarEvent;

const CONNECTED_ACCOUNT = { id: 1, status: 'connected' } as GoogleCalendarAccount;

const PRICING = makeNote({ id: 1, title: 'Pricing call', content: 'Pricing stays at $12.' });
const ROADMAP = makeNote({ id: 2, title: 'Roadmap review', content: 'Pricing page ships in May.' });

const LOCAL_SELECTION = jest.fn(() => ({ mode: 'local' as const }));

const makeMessage = (
  id: string,
  role: ChatMessage['role'],
  text: string,
  sources: ChatMessage['sources'] = [],
): ChatMessage => ({ id, conversationId: 'c1', role, text, steps: [], sources, createdAt: 0 });

const PRIVATE_HISTORY: ChatMessage[] = [
  makeMessage('m1', 'user', 'What was the launch date?'),
  makeMessage('m2', 'assistant', 'Launch is June 3.', [{ noteId: 7, title: 'Launch plan' }]),
  makeMessage('m3', 'user', 'And the price?'),
  makeMessage('m4', 'assistant', 'Price stays at $12.', [{ noteId: 1, title: 'Pricing call' }]),
];

const makeDeps = (overrides: Partial<ChatTurnDeps> = {}): ChatTurnDeps => ({
  getCandidateNotes: jest.fn((terms: string[]) => (terms.length > 0 ? [PRICING, ROADMAP] : [])),
  getConnectedCalendarAccounts: jest.fn(() => [CONNECTED_ACCOUNT]),
  getCalendarEvents: jest.fn(() => []),
  isNotePrivate: jest.fn(() => false),
  chat: jest.fn(async () => ({ text: 'The answer.', model: 'test' })),
  getChatSelection: jest.fn(() => ({ mode: 'openwhispr' as const })),
  ...overrides,
});

const makeInput = (
  overrides: Partial<ChatTurnInput> = {},
): ChatTurnInput & { onSteps: jest.Mock<void, [ChatStep[]]> } => ({
  question: 'What did we decide on pricing?',
  history: [],
  signal: new AbortController().signal,
  allowCloudFallback: false,
  now: NOW,
  ...overrides,
  onSteps: jest.fn<void, [ChatStep[]]>(),
});

const lastSteps = (onSteps: jest.Mock<void, [ChatStep[]]>): ChatStep[] =>
  onSteps.mock.calls[onSteps.mock.calls.length - 1][0];

const sentText = (chat: ChatTurnDeps['chat'], call = 0): string =>
  (chat as jest.Mock).mock.calls[call][0].text;

describe('runChatTurn', () => {
  it('reports calendar, search, read and write steps in order', async () => {
    const deps = makeDeps({
      getCalendarEvents: jest.fn(() => [
        makeEvent('Standup', new Date(2026, 9, 22, 10, 0), new Date(2026, 9, 22, 10, 30)),
      ]),
    });
    const input = makeInput();

    const result = await runChatTurn(input, deps);

    const steps = lastSteps(input.onSteps);
    expect(steps.map((step) => step.id)).toEqual(['calendar', 'search', 'read', 'write']);
    expect(steps.every((step) => step.status === 'done')).toBe(true);
    expect(steps).toEqual([
      {
        id: 'calendar',
        status: 'done',
        label: 'Checked your calendar',
        detail: `Standup · ${formatTime(new Date(2026, 9, 22, 10, 0))}`,
      },
      { id: 'search', status: 'done', label: 'Searched your notes', detail: '2 notes match' },
      { id: 'read', status: 'done', label: 'Read “Pricing call” and 1 more' },
      { id: 'write', status: 'done', label: 'Wrote the answer' },
    ]);
    expect(result).toEqual({
      text: 'The answer.',
      steps,
      sources: [
        { noteId: 1, title: 'Pricing call' },
        { noteId: 2, title: 'Roadmap review' },
      ],
    });
    expect(deps.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: { allowCloudFallback: false },
        signal: input.signal,
        inferenceRoute: { mode: 'openwhispr', scope: 'noteChat' },
      }),
    );
  });

  it('starts each step active and sends a fresh list on every change', async () => {
    const input = makeInput();

    await runChatTurn(input, makeDeps());

    const calls = input.onSteps.mock.calls.map(([steps]) => steps);
    expect(calls[0]).toEqual([
      { id: 'calendar', status: 'active', label: 'Checking your calendar…' },
    ]);
    expect(calls).toContainEqual(
      expect.arrayContaining([
        { id: 'read', status: 'active', label: 'Reading “Pricing call” and 1 more…' },
      ]),
    );
    expect(lastSteps(input.onSteps)).not.toBe(calls[calls.length - 2]);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it('skips the calendar step with no connected account', async () => {
    const deps = makeDeps({ getConnectedCalendarAccounts: jest.fn(() => []) });
    const input = makeInput();

    await runChatTurn(input, deps);

    expect(lastSteps(input.onSteps).map((step) => step.id)).toEqual(['search', 'read', 'write']);
    expect(deps.getCalendarEvents).not.toHaveBeenCalled();
    expect(sentText(deps.chat)).toContain('No calendar connected.');
  });

  it('describes an all-day next event and an untitled one', async () => {
    const allDay = makeDeps({
      getCalendarEvents: jest.fn(() => [
        makeEvent('Offsite', new Date(Date.UTC(2026, 9, 22)), new Date(Date.UTC(2026, 9, 23)), 1),
      ]),
    });
    const allDayInput = makeInput();
    await runChatTurn(allDayInput, allDay);
    expect(lastSteps(allDayInput.onSteps)[0].detail).toBe('Offsite · all day');

    const untitled = makeDeps({
      getCalendarEvents: jest.fn(() => [
        makeEvent(null, new Date(2026, 9, 22, 8, 0), new Date(2026, 9, 22, 8, 30)),
        makeEvent(null, new Date(2026, 9, 22, 11, 0), new Date(2026, 9, 22, 11, 30)),
      ]),
    });
    const untitledInput = makeInput();
    await runChatTurn(untitledInput, untitled);
    expect(lastSteps(untitledInput.onSteps)[0].detail).toBe(
      `Untitled meeting · ${formatTime(new Date(2026, 9, 22, 11, 0))}`,
    );
  });

  it('says when no meetings are coming up but still sends the calendar section', async () => {
    const deps = makeDeps();
    const input = makeInput();

    await runChatTurn(input, deps);

    expect(lastSteps(input.onSteps)[0].detail).toBe('No meetings coming up');
    expect(sentText(deps.chat)).toContain('No meetings in the next 48 hours.');
  });

  it('fills up to two notes with recent ones when nothing matches', async () => {
    const recent = makeNote({ id: 9, title: 'Weekly sync', content: 'Status updates.' });
    const getCandidateNotes = jest.fn((terms: string[]) => (terms.length > 0 ? [] : [recent]));
    const input = makeInput({ question: 'Anything new?' });

    const result = await runChatTurn(input, makeDeps({ getCandidateNotes }));

    expect(getCandidateNotes).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ includePrivate: false }),
    );
    const steps = lastSteps(input.onSteps);
    expect(steps.find((step) => step.id === 'search')?.detail).toBe('No matching notes');
    expect(steps.find((step) => step.id === 'read')?.label).toBe('Read “Weekly sync”');
    expect(result.sources).toEqual([{ noteId: 9, title: 'Weekly sync' }]);
  });

  it('never queries with a blank term and reads no notes when there are none', async () => {
    const getCandidateNotes = jest.fn((_terms: string[]): Note[] => []);
    const input = makeInput({ question: 'Is it?' });

    await runChatTurn(input, makeDeps({ getCandidateNotes }));

    expect(getCandidateNotes.mock.calls.every(([terms]) => !terms.includes(''))).toBe(true);
    expect(getCandidateNotes.mock.calls.filter(([terms]) => terms.length > 0)).toHaveLength(0);
    expect(lastSteps(input.onSteps).map((step) => step.id)).toEqual([
      'calendar',
      'search',
      'write',
    ]);
  });

  it('never sends private notes on a cloud route', async () => {
    const secret = makeNote({
      id: 3,
      title: 'Secret pricing plan',
      content: 'Pricing',
      isPrivate: 1,
    });
    const getCandidateNotes = jest.fn(() => [secret, PRICING]);
    const deps = makeDeps({ getCandidateNotes });

    const result = await runChatTurn(makeInput(), deps);

    for (const [, options] of getCandidateNotes.mock.calls as unknown as [
      string[],
      { includePrivate: boolean },
    ][]) {
      expect(options.includePrivate).toBe(false);
    }
    expect(sentText(deps.chat)).not.toContain('Secret pricing plan');
    expect(result.sources.map((source) => source.noteId)).not.toContain(3);
  });

  it('includes private notes on a local route', async () => {
    const secret = makeNote({
      id: 3,
      title: 'Secret pricing plan',
      content: 'Pricing',
      isPrivate: 1,
    });
    const getCandidateNotes = jest.fn(() => [secret]);
    const deps = makeDeps({ getCandidateNotes, getChatSelection: LOCAL_SELECTION });

    await runChatTurn(makeInput(), deps);

    expect(getCandidateNotes).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ includePrivate: true }),
    );
    expect(sentText(deps.chat)).toContain('Secret pricing plan');
    expect(deps.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: { allowCloudFallback: false, isPrivateNote: true },
        inferenceRoute: { mode: 'local', scope: 'noteChat' },
      }),
    );
  });

  it('sends no history on a cloud route once an answer used a private note', async () => {
    const isNotePrivate = jest.fn((noteId: number) => noteId === 7);
    const deps = makeDeps({ isNotePrivate });

    await runChatTurn(makeInput({ history: PRIVATE_HISTORY }), deps);

    const text = sentText(deps.chat);
    expect(text).toContain('RECENT CHAT:\nNo prior chat messages.');
    expect(text).not.toContain('Launch is June 3.');
    expect(text).not.toContain('Price stays at $12.');
  });

  it('treats a missing source note as private on a cloud route', async () => {
    mockGetNoteById.mockImplementation((noteId: number) => (noteId === 1 ? PRICING : null));
    const deps = makeDeps({ isNotePrivate: createDefaultChatTurnDeps().isNotePrivate });

    await runChatTurn(makeInput({ history: PRIVATE_HISTORY }), deps);

    expect(mockGetNoteById).toHaveBeenCalledWith(7);
    expect(sentText(deps.chat)).toContain('RECENT CHAT:\nNo prior chat messages.');
  });

  it('keeps history whose source notes are all present and shared', async () => {
    mockGetNoteById.mockImplementation((noteId: number) => makeNote({ id: noteId }));
    const deps = makeDeps({ isNotePrivate: createDefaultChatTurnDeps().isNotePrivate });

    await runChatTurn(makeInput({ history: PRIVATE_HISTORY }), deps);

    expect(sentText(deps.chat)).toContain('Launch is June 3.');
  });

  it('drops all history once any answer used a private note', async () => {
    const history = [
      makeMessage('m1', 'user', 'What was the launch date?'),
      makeMessage('m2', 'assistant', 'Launch is June 3.', [{ noteId: 7, title: 'Launch plan' }]),
      makeMessage('m3', 'user', 'Repeat that?'),
      makeMessage('m4', 'assistant', 'As I said, launch is June 3.'),
    ];
    const deps = makeDeps({ isNotePrivate: jest.fn((noteId: number) => noteId === 7) });

    await runChatTurn(makeInput({ history }), deps);

    const text = sentText(deps.chat);
    expect(text).toContain('RECENT CHAT:\nNo prior chat messages.');
    expect(text).not.toContain('As I said, launch is June 3.');
  });

  it('keeps history answers built from private notes on a local route', async () => {
    const isNotePrivate = jest.fn((noteId: number) => noteId === 7);
    const deps = makeDeps({ isNotePrivate, getChatSelection: LOCAL_SELECTION });

    await runChatTurn(makeInput({ history: PRIVATE_HISTORY }), deps);

    const text = sentText(deps.chat);
    expect(text).toContain('What was the launch date?');
    expect(text).toContain('Launch is June 3.');
    expect(isNotePrivate).not.toHaveBeenCalled();
  });

  it('retries a local context-limit error with one short note', async () => {
    const chat = jest
      .fn()
      .mockRejectedValueOnce(new LocalReasoningError('LOCAL_CONTEXT_LIMIT', 'Too long'))
      .mockResolvedValueOnce({ text: 'Short answer.', model: 'local' });
    const deps = makeDeps({ chat, getChatSelection: LOCAL_SELECTION });

    const result = await runChatTurn(makeInput(), deps);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(sentText(chat, 0).match(/###/g)).toHaveLength(2);
    expect(sentText(chat, 1).match(/###/g)).toHaveLength(1);
    expect(result.text).toBe('Short answer.');
    expect(result.sources).toEqual([{ noteId: 1, title: 'Pricing call' }]);
  });

  it('retries a long note cut to the budget', async () => {
    const long = makeNote({
      id: 5,
      title: 'Pricing deep dive',
      content: `Pricing ${'p'.repeat(4_500)}`,
      updatedAt: new Date(2026, 9, 21, 12, 0, 0).toISOString(),
    });
    const chat = jest
      .fn()
      .mockRejectedValueOnce(new LocalReasoningError('LOCAL_CONTEXT_LIMIT', 'Too long'))
      .mockResolvedValueOnce({ text: 'Short answer.', model: 'local' });
    const input = makeInput();
    const deps = makeDeps({
      chat,
      getChatSelection: LOCAL_SELECTION,
      getCandidateNotes: jest.fn((terms: string[]) => (terms.length > 0 ? [long, PRICING] : [])),
    });

    const result = await runChatTurn(input, deps);

    expect(sentText(chat, 0).match(/^### /gm)).toHaveLength(2);
    const retryText = sentText(chat, 1);
    expect(retryText.match(/^### /gm)).toHaveLength(1);
    const longestRun = Math.max(...(retryText.match(/p{10,}/g) ?? ['']).map((run) => run.length));
    expect(longestRun).toBeGreaterThan(2_500);
    expect(longestRun).toBeLessThanOrEqual(3_000);
    expect(result.sources).toEqual([{ noteId: 5, title: 'Pricing deep dive' }]);
    expect(lastSteps(input.onSteps).find((step) => step.id === 'read')).toEqual({
      id: 'read',
      status: 'done',
      label: 'Read “Pricing deep dive”',
    });
    expect(lastSteps(input.onSteps).map((step) => step.id)).toEqual([
      'calendar',
      'search',
      'read',
      'write',
    ]);
  });

  it('uses one route snapshot for both calls', async () => {
    const getChatSelection = jest
      .fn()
      .mockReturnValueOnce({ mode: 'local' })
      .mockReturnValue({ mode: 'openwhispr' });
    const chat = jest.fn(async () => {
      if (chat.mock.calls.length === 1) {
        throw new LocalReasoningError('LOCAL_CONTEXT_LIMIT', 'Too long');
      }
      return { text: 'Short answer.', model: 'local' };
    });

    await runChatTurn(makeInput(), makeDeps({ chat, getChatSelection }));

    expect(chat).toHaveBeenCalledTimes(2);
    for (const [request] of chat.mock.calls as unknown as [{ inferenceRoute: unknown }][]) {
      expect(request.inferenceRoute).toEqual({ mode: 'local', scope: 'noteChat' });
    }
  });

  it('passes a provider selection through as the route', async () => {
    const deps = makeDeps({
      getChatSelection: jest.fn(() => ({
        mode: 'providers' as const,
        providerId: 'openai',
        modelId: 'gpt-5-mini',
        credentialRef: 'openai-key',
      })),
    });

    await runChatTurn(makeInput(), deps);

    expect(deps.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        inferenceRoute: {
          mode: 'providers',
          scope: 'noteChat',
          providerId: 'openai',
          modelId: 'gpt-5-mini',
          endpoint: '',
          credentialRef: 'openai-key',
        },
      }),
    );
  });

  it("keeps going when the calendar can't be read", async () => {
    for (const broken of [
      {
        getConnectedCalendarAccounts: jest.fn((): GoogleCalendarAccount[] => {
          throw new Error('store unavailable');
        }),
      },
      {
        getCalendarEvents: jest.fn((): GoogleCalendarEvent[] => {
          throw new Error('SQLITE_BUSY');
        }),
      },
    ]) {
      const deps = makeDeps(broken);
      const input = makeInput();

      const result = await runChatTurn(input, deps);

      expect(result.text).toBe('The answer.');
      expect(lastSteps(input.onSteps).map((step) => step.id)).toEqual(['search', 'read', 'write']);
      expect(sentText(deps.chat)).toContain('No calendar connected.');
    }
  });

  it('describes only meetings inside the next 48 hours', async () => {
    const deps = makeDeps({
      getCalendarEvents: jest.fn(() => [
        makeEvent('Planning', new Date(2026, 9, 25, 10, 0), new Date(2026, 9, 25, 11, 0)),
      ]),
    });
    const input = makeInput();

    await runChatTurn(input, deps);

    expect(lastSteps(input.onSteps)[0].detail).toBe('No meetings coming up');
  });

  it('rethrows other model errors without retrying', async () => {
    const chat = jest.fn().mockRejectedValue(new Error('Network down'));

    await expect(runChatTurn(makeInput(), makeDeps({ chat }))).rejects.toThrow('Network down');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('stops after an abort', async () => {
    const controller = new AbortController();
    const getCandidateNotes = jest.fn(() => {
      controller.abort();
      return [PRICING];
    });
    const deps = makeDeps({ getCandidateNotes });

    const promise = runChatTurn(makeInput({ signal: controller.signal }), deps);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.chat).not.toHaveBeenCalled();
  });

  it('does not retry or resolve once aborted during the model call', async () => {
    const controller = new AbortController();
    const chat = jest.fn(async () => {
      controller.abort();
      throw new LocalReasoningError('LOCAL_CONTEXT_LIMIT', 'Too long');
    });

    await expect(
      runChatTurn(makeInput({ signal: controller.signal }), makeDeps({ chat })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
