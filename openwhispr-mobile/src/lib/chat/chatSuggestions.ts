import type { GoogleCalendarEvent, Note } from '@/data';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import { formatChatDate, formatChatTime, isSameLocalDay, shiftLocalDay } from './chatContext';

export interface ChatSuggestion {
  kind: 'calendar' | 'note' | 'actions';
  meta: string;
  label: string;
  prompt: string;
}

export interface ChatSuggestionsInput {
  /** Upcoming events by start time; the first one worth prepping for is suggested. */
  events: GoogleCalendarEvent[];
  recentMeetingNote: Note | null;
  now: Date;
}

const RECENTLY_STARTED_MS = 15 * 60 * 1000;
const describeDay = (date: Date, now: Date): string => {
  if (isSameLocalDay(date, now)) return 'Today';
  if (isSameLocalDay(date, shiftLocalDay(now, -1))) return 'Yesterday';
  return formatChatDate(date);
};

const calendarSuggestion = (event: GoogleCalendarEvent, now: Date): ChatSuggestion | null => {
  // An all-day event has no start time to prep for.
  if (event.allDay) return null;
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
  events,
  recentMeetingNote,
  now,
}: ChatSuggestionsInput): ChatSuggestion[] => {
  const suggestions: ChatSuggestion[] = [];

  // A meeting still running, or an all-day event, mustn't hide a later meeting today.
  for (const event of events) {
    const calendar = calendarSuggestion(event, now);
    if (calendar) {
      suggestions.push(calendar);
      break;
    }
  }
  if (recentMeetingNote) suggestions.push(noteSuggestion(recentMeetingNote, now));

  suggestions.push({
    kind: 'actions',
    meta: 'This week',
    label: 'List my open action items',
    prompt: "List my open action items from this week's notes.",
  });
  return suggestions;
};
