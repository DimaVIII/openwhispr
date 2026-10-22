import type { GoogleCalendarEvent, Note } from '@/data';
import {
  buildChatPayload,
  CHAT_NOTE_CHAR_CAP,
  CHAT_SYSTEM_PROMPT,
  extractSearchTerms,
  rankChatNotes,
} from '../chatContext';
import type { ChatMessage } from '../types';

// Built with local-time constructors so assertions don't depend on the machine's timezone.
const NOW = new Date(2026, 9, 22, 9, 0, 0);

const makeNote = (overrides: Partial<Note> & { id: number }): Note =>
  ({
    title: 'Untitled',
    content: '',
    enhancedContent: null,
    updatedAt: new Date(2026, 9, 20, 12, 0, 0).toISOString(),
    ...overrides,
  }) as Note;

const makeEvent = (summary: string | null, start: Date, end: Date): GoogleCalendarEvent =>
  ({
    id: 1,
    summary,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  }) as GoogleCalendarEvent;

const makeMessage = (index: number): ChatMessage => ({
  id: `m${index}`,
  conversationId: 'c1',
  role: index % 2 === 0 ? 'user' : 'assistant',
  text: `message ${index}`,
  steps: [],
  sources: [],
  createdAt: index,
});

const buildPayload = (overrides: Partial<Parameters<typeof buildChatPayload>[0]> = {}) =>
  buildChatPayload({
    question: 'What happened?',
    history: [],
    notes: [],
    calendar: [],
    now: NOW,
    ...overrides,
  });

describe('extractSearchTerms', () => {
  it('drops stopwords and short words', () => {
    expect(extractSearchTerms('What did Priya say about the onboarding flow?')).toEqual([
      'priya',
      'say',
      'onboarding',
      'flow',
    ]);
  });

  it('de-duplicates and keeps at most six terms', () => {
    expect(extractSearchTerms('alpha alpha beta gamma delta epsilon zeta eta theta')).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
    ]);
  });

  it('never returns a blank term', () => {
    expect(extractSearchTerms('  ?? ! a to ')).toEqual([]);
  });
});

describe('rankChatNotes', () => {
  it('ranks a title match above a body match', () => {
    const bodyHit = makeNote({ id: 1, title: 'Weekly sync', content: 'We covered onboarding.' });
    const titleHit = makeNote({ id: 2, title: 'Onboarding review', content: 'Nothing here.' });

    expect(rankChatNotes([bodyHit, titleHit], ['onboarding']).map((note) => note.id)).toEqual([
      2, 1,
    ]);
  });

  it('breaks ties with the newer update', () => {
    const older = makeNote({ id: 1, title: 'Plan', updatedAt: '2026-10-01T10:00:00.000Z' });
    const newer = makeNote({ id: 2, title: 'Plan', updatedAt: '2026-10-10T10:00:00.000Z' });

    expect(rankChatNotes([older, newer], ['plan']).map((note) => note.id)).toEqual([2, 1]);
  });
});

describe('buildChatPayload', () => {
  it('uses the assistant system prompt', () => {
    expect(buildPayload().systemPrompt).toBe(CHAT_SYSTEM_PROMPT);
  });

  it('fills notes until the budget and lists only the included notes as sources', () => {
    const notes = [1, 2, 3].map((id) =>
      makeNote({ id, title: `Note ${id}`, content: 'x'.repeat(7_000) }),
    );

    const { text, sources } = buildPayload({ notes, noteCharBudget: 13_000 });

    expect(text.match(/^### /gm)).toHaveLength(2);
    expect(text).not.toContain('x'.repeat(CHAT_NOTE_CHAR_CAP + 1));
    expect(sources).toEqual([
      { noteId: 1, title: 'Note 1' },
      { noteId: 2, title: 'Note 2' },
    ]);
  });

  it('says when there are no matching notes', () => {
    expect(buildPayload().text).toContain('NOTES:\nNo matching notes.');
  });

  it('says when no calendar is connected', () => {
    expect(buildPayload({ calendar: null }).text).toContain('No calendar connected.');
  });

  it('says when the next 48 hours are empty', () => {
    expect(buildPayload({ calendar: [] }).text).toContain('No meetings in the next 48 hours.');
  });

  it('lists only meetings in the next 48 hours', () => {
    const calendar = [
      makeEvent('Already over', new Date(2026, 9, 22, 7, 0), new Date(2026, 9, 22, 8, 0)),
      makeEvent('Standup', new Date(2026, 9, 22, 10, 0), new Date(2026, 9, 22, 10, 30)),
      makeEvent(null, new Date(2026, 9, 23, 14, 0), new Date(2026, 9, 23, 15, 0)),
      makeEvent('Next week', new Date(2026, 9, 28, 10, 0), new Date(2026, 9, 28, 11, 0)),
    ];
    const time = (date: Date): string =>
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const { text } = buildPayload({ calendar });

    expect(text).toContain(
      `- Standup · ${time(new Date(2026, 9, 22, 10, 0))}–${time(new Date(2026, 9, 22, 10, 30))}`,
    );
    expect(text).toContain('- Untitled meeting · ');
    expect(text).not.toContain('Already over');
    expect(text).not.toContain('Next week');
  });

  it('keeps only the last six history messages', () => {
    const history = Array.from({ length: 8 }, (_, index) => makeMessage(index));

    const { text } = buildPayload({ history });

    expect(text).not.toContain('message 1');
    expect(text).toContain('message 2');
    expect(text).toContain('message 7');
  });

  it('lays the sections out in order', () => {
    const { text } = buildPayload({
      question: 'Why?',
      notes: [makeNote({ id: 1, title: 'Plan', content: 'Body' })],
    });
    const positions = [
      'TODAY:',
      'CALENDAR (next 48 hours):',
      'NOTES:',
      'RECENT CHAT:',
      'USER QUESTION:',
    ].map((heading) => text.indexOf(heading));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toMatch(/### Plan \(updated Oct 20\)\nBody/);
    expect(text.endsWith('USER QUESTION:\nWhy?')).toBe(true);
  });
});
