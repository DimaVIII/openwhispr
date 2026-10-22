import type { GoogleCalendarEvent, Note } from '@/data';
import { buildChatSuggestions } from '../chatSuggestions';

// Built with local-time constructors so assertions don't depend on the machine's timezone.
const NOW = new Date(2026, 9, 22, 9, 0, 0);

const makeEvent = (summary: string, start: Date): GoogleCalendarEvent =>
  ({
    id: 1,
    summary,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
  }) as GoogleCalendarEvent;

const makeNote = (title: string, updatedAt: Date): Note =>
  ({ id: 7, title, updatedAt: updatedAt.toISOString() }) as Note;

const time = (date: Date): string =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

describe('buildChatSuggestions', () => {
  it('suggests the next meeting, a recent meeting note, then action items', () => {
    const start = new Date(2026, 9, 22, 11, 0);

    const suggestions = buildChatSuggestions({
      nextEvent: makeEvent('Design review', start),
      recentMeetingNote: makeNote('Roadmap sync', new Date(2026, 9, 21, 15, 0)),
      now: NOW,
    });

    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual([
      'calendar',
      'note',
      'actions',
    ]);
    expect(suggestions[0]).toEqual({
      kind: 'calendar',
      meta: `Design review · ${time(start)}`,
      label: 'Prep me for this meeting',
      prompt: `Prep me for "Design review" at ${time(start)}.`,
    });
    expect(suggestions[1]).toEqual({
      kind: 'note',
      meta: 'Roadmap sync · Yesterday',
      label: 'What did we decide, and who owns what?',
      prompt: 'What did we decide in "Roadmap sync", and who owns what?',
    });
    expect(suggestions[2]).toEqual({
      kind: 'actions',
      meta: 'This week',
      label: 'List my open action items',
      prompt: "List my open action items from this week's notes.",
    });
  });

  it('skips a meeting that started more than 15 minutes ago', () => {
    const suggestions = buildChatSuggestions({
      nextEvent: makeEvent('Standup', new Date(2026, 9, 22, 8, 40)),
      recentMeetingNote: null,
      now: NOW,
    });

    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual(['actions']);
  });

  it('keeps a meeting that started within the last 15 minutes', () => {
    const suggestions = buildChatSuggestions({
      nextEvent: makeEvent('Standup', new Date(2026, 9, 22, 8, 50)),
      recentMeetingNote: null,
      now: NOW,
    });

    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual(['calendar', 'actions']);
  });

  it('skips a meeting that starts on another day', () => {
    const suggestions = buildChatSuggestions({
      nextEvent: makeEvent('Tomorrow sync', new Date(2026, 9, 23, 10, 0)),
      recentMeetingNote: null,
      now: NOW,
    });

    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual(['actions']);
  });

  it('labels a note updated today and one from an earlier day', () => {
    const today = buildChatSuggestions({
      nextEvent: null,
      recentMeetingNote: makeNote('Kickoff', new Date(2026, 9, 22, 8, 0)),
      now: NOW,
    });
    const earlier = buildChatSuggestions({
      nextEvent: null,
      recentMeetingNote: makeNote('Kickoff', new Date(2026, 9, 18, 8, 0)),
      now: NOW,
    });

    expect(today[0].meta).toBe('Kickoff · Today');
    expect(earlier[0].meta).toBe('Kickoff · Oct 18');
  });
});
