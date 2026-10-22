import { eq } from 'drizzle-orm';
import type { GoogleCalendarEvent } from '@/data';
import { notes } from '@/db/schema';
import { createMemoryRepository } from '@/data/local/__tests__/testDb';
import { buildChatSuggestions } from '../chatSuggestions';
import { runChatTurn, type ChatTurnDeps } from '../runChatTurn';

// Every chip on the Chat root must reach notes through the real search, even when none of its
// words appear in them, and never reach notes it isn't about.

// Thursday, October 22. Built with local-time constructors so the periods don't depend on the
// machine's timezone.
const NOW = new Date(2026, 9, 22, 9, 0, 0);

const setUp = (): { deps: ChatTurnDeps; ids: Record<string, number> } => {
  const { repo, db } = createMemoryRepository();
  const seed = (title: string, content: string, created: Date, noteType = 'personal'): number => {
    const { id } = repo.createNote(title, content);
    const createdAt = created.toISOString();
    db.update(notes)
      .set({ noteType, createdAt, updatedAt: createdAt })
      .where(eq(notes.id, id))
      .run();
    return id;
  };

  const ids = {
    // This week's meeting says nothing a chip asks about in so many words.
    contractCall: seed(
      'Contract call',
      'Dana sends the contract by Friday.',
      new Date(2026, 9, 21, 15, 0),
      'meeting',
    ),
    groceries: seed('Groceries', 'Oat milk, coffee.', new Date(2026, 9, 20, 18, 0)),
    acmeKickoff: seed(
      'Acme sync',
      'Kickoff: renewal is due in March.',
      new Date(2026, 8, 10, 10, 0),
      'meeting',
    ),
    oldDecision: seed('Paint', 'We decided on blue.', new Date(2026, 8, 1, 12, 0)),
    oldSeats: seed('Seats', 'Ship 15 seats.', new Date(2026, 8, 2, 12, 0)),
    budget: seed('Budget', 'Prepare the budget.', new Date(2026, 8, 3, 12, 0)),
  };

  const deps: ChatTurnDeps = {
    getCandidateNotes: (terms, options) => repo.getChatCandidateNotes(terms, options),
    isNotePrivate: () => false,
    getNoteTranscript: () => '',
    getConnectedCalendarAccounts: () => [],
    getCalendarEvents: () => [],
    chat: jest.fn(async () => ({ text: 'The answer.', model: 'test' })),
    getChatSelection: () => ({ mode: 'openwhispr' }),
  };
  return { deps, ids };
};

const sourcesFor = async (question: string, deps: ChatTurnDeps): Promise<number[]> => {
  const result = await runChatTurn(
    {
      question,
      history: [],
      signal: new AbortController().signal,
      allowCloudFallback: false,
      onSteps: () => undefined,
      now: NOW,
    },
    deps,
  );
  return result.sources.map((source) => source.noteId);
};

const ACME_SYNC = {
  id: 1,
  summary: 'Acme sync',
  startAt: new Date(2026, 9, 22, 15, 15).toISOString(),
  endAt: new Date(2026, 9, 22, 15, 45).toISOString(),
  allDay: 0,
} as GoogleCalendarEvent;

const chip = (label: string): string => {
  const suggestion = buildChatSuggestions({ events: [ACME_SYNC], now: NOW }).find(
    (candidate) => candidate.label === label,
  );
  if (!suggestion) throw new Error(`No chip labelled ${label}`);
  return suggestion.prompt;
};

describe('Chat root chips', () => {
  it('summarizes only this week’s meetings', async () => {
    const { deps, ids } = setUp();
    expect(await sourcesFor(chip('Summarize my meetings this week'), deps)).toEqual([
      ids.contractCall,
    ]);
  });

  it.each([
    'What are my open action items from this week?',
    'Who have I promised to follow up with lately?',
  ])('reads this week’s notes for “%s”', async (label) => {
    const { deps, ids } = setUp();
    expect(await sourcesFor(chip(label), deps)).toEqual([ids.contractCall, ids.groceries]);
  });

  it('reads the last 7 days’ notes, not an older decision', async () => {
    const { deps, ids } = setUp();
    expect(await sourcesFor(chip('What did I decide recently?'), deps)).toEqual([
      ids.contractCall,
      ids.groceries,
    ]);
  });

  it('preps for a meeting from the notes about it alone', async () => {
    const { deps, ids } = setUp();
    expect(await sourcesFor(chip('Prep me for Acme sync'), deps)).toEqual([ids.acmeKickoff]);
  });

  it('sends no notes for a question none of them answer', async () => {
    const { deps } = setUp();
    expect(await sourcesFor('What is the capital of France?', deps)).toEqual([]);
  });
});
