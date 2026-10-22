import type { GoogleCalendarEvent, Note } from '@/data';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import { formatChatDate, formatChatTime } from './chatContext';

export interface ChatSuggestion {
  kind: 'calendar' | 'note' | 'actions';
  meta: string;
  label: string;
  prompt: string;
}

export interface ChatSuggestionsInput {
  nextEvent: GoogleCalendarEvent | null;
  recentMeetingNote: Note | null;
  now: Date;
}

const RECENTLY_STARTED_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const isSameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const describeDay = (date: Date, now: Date): string => {
  if (isSameLocalDay(date, now)) return 'Today';
  if (isSameLocalDay(date, new Date(now.getTime() - DAY_MS))) return 'Yesterday';
  return formatChatDate(date);
};

const calendarSuggestion = (event: GoogleCalendarEvent, now: Date): ChatSuggestion | null => {
  const start = tryParseNoteTimestamp(event.startAt);
  if (!start || !isSameLocalDay(start, now)) return null;
  if (start.getTime() < now.getTime() - RECENTLY_STARTED_MS) return null;

  const summary = event.summary?.trim() || 'Untitled meeting';
  const time = formatChatTime(start);
  return {
    kind: 'calendar',
    meta: `${summary} · ${time}`,
    label: 'Prep me for this meeting',
    prompt: `Prep me for "${summary}" at ${time}.`,
  };
};

const noteSuggestion = (note: Note, now: Date): ChatSuggestion => {
  const updated = tryParseNoteTimestamp(note.updatedAt);
  return {
    kind: 'note',
    meta: updated ? `${note.title} · ${describeDay(updated, now)}` : note.title,
    label: 'What did we decide, and who owns what?',
    prompt: `What did we decide in "${note.title}", and who owns what?`,
  };
};

export const buildChatSuggestions = ({
  nextEvent,
  recentMeetingNote,
  now,
}: ChatSuggestionsInput): ChatSuggestion[] => {
  const suggestions: ChatSuggestion[] = [];

  const calendar = nextEvent ? calendarSuggestion(nextEvent, now) : null;
  if (calendar) suggestions.push(calendar);
  if (recentMeetingNote) suggestions.push(noteSuggestion(recentMeetingNote, now));

  suggestions.push({
    kind: 'actions',
    meta: 'This week',
    label: 'List my open action items',
    prompt: "List my open action items from this week's notes.",
  });
  return suggestions;
};
