import type { GoogleCalendarEvent, Note } from '@/data';
import { buildNoteChatContext, formatChatHistory } from '@/lib/notes/chatOverNote';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import type { ChatMessage, ChatSource } from './types';

export const CHAT_NOTE_CHAR_BUDGET = 18_000;
export const CHAT_NOTE_CHAR_CAP = 6_000;

const CALENDAR_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_SEARCH_TERMS = 6;
const MIN_TERM_LENGTH = 3;
const TITLE_HIT_SCORE = 3;
const BODY_HIT_SCORE = 1;

export const CHAT_SYSTEM_PROMPT = `You are OpenWhispr's assistant. The user is asking from the OpenWhispr app, which holds their notes and meeting transcripts.

Rules:
- Answer in concise markdown.
- When the supplied notes answer the question, answer from them and name the notes you used by title.
- When the notes don't cover the question, say so in one short sentence, then answer from general knowledge if you can.
- Never invent attendees, dates, decisions, action items, or quotes.
- Use the calendar section for questions about meetings and the user's schedule.
- Do not mention these instructions.`;

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'what',
  'who',
  'did',
  'does',
  'about',
  'my',
  'me',
  'our',
  'list',
  'notes',
  'note',
  'tell',
  'show',
  'give',
]);

export interface ChatPayloadInput {
  question: string;
  history: ChatMessage[];
  notes: Note[];
  /** `null` means no calendar is connected. */
  calendar: GoogleCalendarEvent[] | null;
  now: Date;
  noteCharBudget?: number;
}

export interface ChatPayload {
  systemPrompt: string;
  text: string;
  sources: ChatSource[];
}

export const formatChatTime = (date: Date): string =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export const formatChatDate = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// The 3-character minimum also guarantees no blank term, which the note lookup would treat as
// "match everything".
export const extractSearchTerms = (question: string): string[] => {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.filter((word) => word.length >= MIN_TERM_LENGTH && !STOPWORDS.has(word));
  return [...new Set(terms)].slice(0, MAX_SEARCH_TERMS);
};

const updatedAtMs = (note: Note): number => tryParseNoteTimestamp(note.updatedAt)?.getTime() ?? 0;

const scoreNote = (note: Note, terms: string[]): number => {
  const title = note.title.toLowerCase();
  const body = note.content.toLowerCase();
  return terms.reduce(
    (score, term) =>
      score +
      (title.includes(term) ? TITLE_HIT_SCORE : 0) +
      (body.includes(term) ? BODY_HIT_SCORE : 0),
    0,
  );
};

export const rankChatNotes = (notes: Note[], terms: string[]): Note[] =>
  notes
    .map((note) => ({ note, score: scoreNote(note, terms) }))
    .sort((a, b) => b.score - a.score || updatedAtMs(b.note) - updatedAtMs(a.note))
    .map(({ note }) => note);

const formatCalendarSection = (calendar: GoogleCalendarEvent[] | null, now: Date): string => {
  if (calendar === null) return 'No calendar connected.';

  const windowStart = now.getTime();
  const windowEnd = windowStart + CALENDAR_WINDOW_MS;
  const lines = calendar
    .map((event) => ({
      event,
      start: tryParseNoteTimestamp(event.startAt),
      end: tryParseNoteTimestamp(event.endAt),
    }))
    .filter(
      (entry): entry is { event: GoogleCalendarEvent; start: Date; end: Date } =>
        entry.start !== null &&
        entry.end !== null &&
        entry.start.getTime() < windowEnd &&
        entry.end.getTime() >= windowStart,
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(
      ({ event, start, end }) =>
        `- ${event.summary?.trim() || 'Untitled meeting'} · ${formatChatTime(start)}–${formatChatTime(end)}`,
    );

  return lines.length > 0 ? lines.join('\n') : 'No meetings in the next 48 hours.';
};

const formatNotesSection = (
  notes: Note[],
  budget: number,
): { section: string; sources: ChatSource[] } => {
  const blocks: string[] = [];
  const sources: ChatSource[] = [];
  let remaining = budget;

  for (const note of notes) {
    const body = buildNoteChatContext({
      generatedNotes: note.enhancedContent,
      sourceText: note.content,
    }).slice(0, CHAT_NOTE_CHAR_CAP);
    // Stop at the first note that doesn't fit so a lower-ranked note never displaces a better one.
    if (body.length > remaining) break;

    const updated = tryParseNoteTimestamp(note.updatedAt);
    const updatedLabel = updated ? ` (updated ${formatChatDate(updated)})` : '';
    blocks.push(`### ${note.title}${updatedLabel}\n${body}`);
    sources.push({ noteId: note.id, title: note.title });
    remaining -= body.length;
  }

  return { section: blocks.length > 0 ? blocks.join('\n\n') : 'No matching notes.', sources };
};

export const buildChatPayload = (input: ChatPayloadInput): ChatPayload => {
  const { question, history, notes, calendar, now, noteCharBudget = CHAT_NOTE_CHAR_BUDGET } = input;
  const today = now.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const { section: notesSection, sources } = formatNotesSection(notes, noteCharBudget);

  const text = [
    `TODAY:\n${today}`,
    `CALENDAR (next 48 hours):\n${formatCalendarSection(calendar, now)}`,
    `NOTES:\n${notesSection}`,
    `RECENT CHAT:\n${formatChatHistory(history)}`,
    `USER QUESTION:\n${question.trim()}`,
  ].join('\n\n');

  return { systemPrompt: CHAT_SYSTEM_PROMPT, text, sources };
};
