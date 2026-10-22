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

const formatTime = (date: Date): string =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

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

  it('drops question words and auxiliaries', () => {
    expect(extractSearchTerms('When was the Acme kickoff, and how have we done?')).toEqual([
      'acme',
      'kickoff',
    ]);
  });

  it('keeps two-character terms', () => {
    expect(extractSearchTerms('What is our Q3 AI budget?')).toEqual(['q3', 'ai', 'budget']);
  });

  it('splits Chinese and Japanese runs into bigrams', () => {
    expect(extractSearchTerms('预算会议')).toEqual(['预算', '算会', '会议']);
    expect(extractSearchTerms('Acme 会議')).toEqual(['acme', '会議']);
    expect(extractSearchTerms('第三季度预算会议的结论是什么')).toHaveLength(6);
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

  it('ranks a note that matches only in its AI summary', () => {
    const noMatch = makeNote({ id: 1, title: 'Sync', content: 'Nothing relevant.' });
    const summaryHit = makeNote({
      id: 2,
      title: 'Sync',
      content: 'Nothing relevant.',
      enhancedContent: '## Decisions\n- Launch onboarding Friday',
    });

    expect(rankChatNotes([noMatch, summaryHit], ['onboarding']).map((note) => note.id)).toEqual([
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

  it('cuts the first note to the budget instead of dropping it', () => {
    const notes = [
      makeNote({ id: 1, title: 'Long', content: 'a'.repeat(4_000) }),
      makeNote({ id: 2, title: 'Also long', content: 'b'.repeat(4_000) }),
    ];

    const { text, sources } = buildPayload({ notes, noteCharBudget: 3_000 });

    expect(sources).toEqual([{ noteId: 1, title: 'Long' }]);
    expect(text.match(/^### /gm)).toHaveLength(1);
    expect(text).toContain('[...rest of the note omitted...]');
    expect(
      text.match(/a+/g)?.reduce((longest, run) => Math.max(longest, run.length), 0),
    ).toBeLessThanOrEqual(3_000);
    expect(text).not.toContain('b'.repeat(10));
  });

  it('fits a smaller later note after skipping one that is too long', () => {
    const notes = [
      makeNote({ id: 1, title: 'First', content: 'a'.repeat(5_000) }),
      makeNote({ id: 2, title: 'Too long', content: 'b'.repeat(5_000) }),
      makeNote({ id: 3, title: 'Small', content: 'c'.repeat(500) }),
    ];

    const { sources } = buildPayload({ notes, noteCharBudget: 6_000 });

    expect(sources.map((source) => source.noteId)).toEqual([1, 3]);
  });

  it('sends the transcript of a note with no text or summary', () => {
    const notes = [
      makeNote({ id: 1, title: 'Weekly sync' }),
      makeNote({ id: 2, title: 'Summarized', enhancedContent: 'The summary' }),
    ];
    const transcripts = new Map([
      [1, 'Meeting transcript:\n[00:00] Priya: We ship Friday.'],
      [2, 'Meeting transcript:\n[00:00] Sam: Not sent.'],
    ]);

    const { text } = buildPayload({ notes, transcripts });

    expect(text).toContain('### Weekly sync');
    expect(text).toContain('[00:00] Priya: We ship Friday.');
    expect(text).toContain('The summary');
    expect(text).not.toContain('Not sent.');
  });

  it('says when there are no matching notes', () => {
    expect(buildPayload().text).toContain('NOTES:\nNo matching notes.');
  });

  it('says when no calendar is connected', () => {
    expect(buildPayload({ calendar: null }).text).toContain('No calendar connected.');
  });

  it('says when the calendar could not be read', () => {
    const { text } = buildPayload({ calendar: 'unavailable' });
    expect(text).toContain('CALENDAR (next 48 hours):\nCalendar unavailable right now.');
    expect(text).not.toContain('No calendar connected.');
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
    const { text } = buildPayload({ calendar });

    expect(text).toContain(
      `- Standup · ${formatTime(new Date(2026, 9, 22, 10, 0))}–${formatTime(new Date(2026, 9, 22, 10, 30))}`,
    );
    expect(text).toContain('- Untitled meeting · ');
    expect(text).not.toContain('Already over');
    expect(text).not.toContain('Next week');
  });

  it("labels tomorrow's meetings", () => {
    const start = new Date(2026, 9, 23, 14, 0);
    const end = new Date(2026, 9, 23, 15, 0);

    const { text } = buildPayload({ calendar: [makeEvent('Review', start, end)] });

    expect(text).toContain(`- Review · Tomorrow ${formatTime(start)}–${formatTime(end)}`);
  });

  it('labels later meetings with the weekday and date', () => {
    const start = new Date(2026, 9, 24, 8, 30);
    const end = new Date(2026, 9, 24, 9, 0);
    const label = start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    // 47 hours after NOW: inside the window, but two calendar days out.
    const { text } = buildPayload({ calendar: [makeEvent('Planning', start, end)] });

    expect(text).toContain(`- Planning · ${label} ${formatTime(start)}–${formatTime(end)}`);
  });

  it('shows all-day events without times', () => {
    const allDay = (summary: string, startDate: string, endDate: string): GoogleCalendarEvent =>
      ({
        id: 2,
        summary,
        allDay: 1,
        startAt: `${startDate}T00:00:00.000Z`,
        endAt: `${endDate}T00:00:00.000Z`,
      }) as GoogleCalendarEvent;

    const { text } = buildPayload({
      calendar: [
        allDay('Offsite', '2026-10-22', '2026-10-23'),
        allDay('Holiday', '2026-10-23', '2026-10-24'),
        allDay('Last week', '2026-10-14', '2026-10-15'),
      ],
    });

    expect(text).toContain('- Offsite · Today · all day');
    expect(text).toContain('- Holiday · Tomorrow · all day');
    expect(text).not.toContain('Last week');
    expect(text).not.toMatch(/all day.*AM|PM.*all day/);
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
