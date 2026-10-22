import type { GoogleCalendarEvent, Note } from '@/data';
import { buildNoteChatContext, formatChatHistory } from '@/lib/notes/chatOverNote';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import type { ChatMessage, ChatSource } from './types';

export const CHAT_NOTE_CHAR_BUDGET = 18_000;
export const CHAT_NOTE_CHAR_CAP = 6_000;

const CALENDAR_WINDOW_MS = 48 * 60 * 60 * 1000;
const NOTE_CUT_MARKER = '\n\n[...rest of the note omitted...]';
const MAX_SEARCH_TERMS = 6;
// Two characters keeps terms like "Q3" and "AI"; the stopwords drop the common short words.
const MIN_TERM_LENGTH = 2;
// Chinese and Japanese don't put spaces between words, so their runs are searched as bigrams.
const UNSPACED_SCRIPT_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
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
  'whom',
  'whose',
  'when',
  'where',
  'which',
  'why',
  'how',
  'did',
  'does',
  'do',
  'done',
  'is',
  'are',
  'am',
  'was',
  'were',
  'be',
  'been',
  'being',
  'has',
  'have',
  'had',
  'can',
  'could',
  'will',
  'would',
  'should',
  'shall',
  'may',
  'might',
  'must',
  'about',
  'any',
  'some',
  'there',
  'their',
  'they',
  'them',
  'you',
  'your',
  'we',
  'us',
  'it',
  'its',
  'an',
  'as',
  'at',
  'by',
  'if',
  'in',
  'into',
  'of',
  'on',
  'or',
  'so',
  'to',
  'up',
  'no',
  'not',
  'but',
  'all',
  'my',
  'me',
  'our',
  'list',
  'notes',
  'note',
  'tell',
  'show',
  'give',
  'please',
]);

/** `null` means no calendar is connected; `'unavailable'` means one is but couldn't be read. */
export type ChatCalendar = GoogleCalendarEvent[] | null | 'unavailable';

export interface ChatPayloadInput {
  question: string;
  history: ChatMessage[];
  notes: Note[];
  calendar: ChatCalendar;
  now: Date;
  noteCharBudget?: number;
  /** Transcripts of the notes with no text or summary of their own, by note id. */
  transcripts?: ReadonlyMap<number, string>;
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

export const isSameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Steps by calendar day rather than 24 hours so DST changes don't shift the day.
export const shiftLocalDay = (date: Date, days: number): Date => {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
};

const toBigrams = (run: string): string[] => {
  const characters = Array.from(run);
  return characters.slice(1).map((character, index) => `${characters[index]}${character}`);
};

// The note lookup treats a blank term as "match everything". Matching whole letter/digit runs
// can't produce one, and the length filter drops the short leftovers.
export const extractSearchTerms = (question: string): string[] => {
  const lower = question.toLowerCase();
  const words = (lower.replace(UNSPACED_SCRIPT_RUN, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => word.length >= MIN_TERM_LENGTH && !STOPWORDS.has(word),
  );
  const bigrams = (lower.match(UNSPACED_SCRIPT_RUN) ?? []).flatMap(toBigrams);
  return [...new Set([...words, ...bigrams])].slice(0, MAX_SEARCH_TERMS);
};

/** Whether a note has neither text nor an AI summary, so only its transcript can say anything. */
export const lacksNoteText = (note: Note): boolean =>
  !note.content.trim() && !note.enhancedContent?.trim();

const updatedAtMs = (note: Note): number => tryParseNoteTimestamp(note.updatedAt)?.getTime() ?? 0;

const scoreNote = (note: Note, terms: string[]): number => {
  const title = note.title.toLowerCase();
  // The AI summary is what gets sent to the model, so it counts toward relevance too.
  const body = `${note.content}\n${note.enhancedContent ?? ''}`.toLowerCase();
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

interface CalendarEntry {
  event: GoogleCalendarEvent;
  // Where the event sits on the timeline, and the local day it is labelled with.
  sortTime: number;
  day: Date;
  start: Date;
  end: Date;
}

// All-day events are stored as UTC midnight of the calendar date, so their date is read from the
// UTC parts. Reading local parts would shift them a day in zones behind UTC.
const utcDateAsLocalDay = (date: Date): Date =>
  new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const toCalendarEntry = (
  event: GoogleCalendarEvent,
  now: Date,
  windowEnd: number,
): CalendarEntry | null => {
  const start = tryParseNoteTimestamp(event.startAt);
  const end = tryParseNoteTimestamp(event.endAt);
  if (!start || !end) return null;

  if (event.allDay) {
    const firstDay = utcDateAsLocalDay(start);
    // endAt is the exclusive end date, so the event's last day is the one before it.
    const endDay = utcDateAsLocalDay(end);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (endDay.getTime() <= today.getTime() || firstDay.getTime() >= windowEnd) return null;
    const day = firstDay.getTime() < today.getTime() ? today : firstDay;
    return { event, sortTime: day.getTime(), day, start, end };
  }

  if (start.getTime() >= windowEnd || end.getTime() < now.getTime()) return null;
  return { event, sortTime: start.getTime(), day: start, start, end };
};

/** Whether an event belongs in the request's calendar section: not ended and starting within 48 hours. */
export const isInChatCalendarWindow = (event: GoogleCalendarEvent, now: Date): boolean =>
  toCalendarEntry(event, now, now.getTime() + CALENDAR_WINDOW_MS) !== null;

const formatCalendarDay = (day: Date, now: Date): string => {
  if (isSameLocalDay(day, now)) return 'Today';
  if (isSameLocalDay(day, shiftLocalDay(now, 1))) return 'Tomorrow';
  return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const formatCalendarLine = ({ event, day, start, end }: CalendarEntry, now: Date): string => {
  const summary = event.summary?.trim() || 'Untitled meeting';
  if (event.allDay) return `- ${summary} · ${formatCalendarDay(day, now)} · all day`;

  const dayLabel = isSameLocalDay(day, now) ? '' : `${formatCalendarDay(day, now)} `;
  return `- ${summary} · ${dayLabel}${formatChatTime(start)}–${formatChatTime(end)}`;
};

const formatCalendarSection = (calendar: ChatCalendar, now: Date): string => {
  if (calendar === null) return 'No calendar connected.';
  if (calendar === 'unavailable') return 'Calendar unavailable right now.';

  const windowEnd = now.getTime() + CALENDAR_WINDOW_MS;
  const lines = calendar
    .map((event) => toCalendarEntry(event, now, windowEnd))
    .filter((entry): entry is CalendarEntry => entry !== null)
    .sort((a, b) => a.sortTime - b.sortTime)
    .map((entry) => formatCalendarLine(entry, now));

  return lines.length > 0 ? lines.join('\n') : 'No meetings in the next 48 hours.';
};

const formatNotesSection = (
  notes: Note[],
  budget: number,
  transcripts: ReadonlyMap<number, string> | undefined,
): { section: string; sources: ChatSource[] } => {
  const blocks: string[] = [];
  const sources: ChatSource[] = [];
  let remaining = budget;

  for (const note of notes) {
    // A meeting whose summary never ran is sent as its transcript.
    const sourceText = lacksNoteText(note) ? (transcripts?.get(note.id) ?? '') : note.content;
    const body = buildNoteChatContext({
      generatedNotes: note.enhancedContent,
      sourceText,
    }).slice(0, CHAT_NOTE_CHAR_CAP);
    // The top note is cut to fit rather than dropped, so a tight budget still sends one note. Any
    // later note that won't fit is dropped whole, but a smaller, lower-ranked one may still fit.
    let included = body;
    if (body.length > remaining) {
      if (blocks.length > 0 || remaining <= NOTE_CUT_MARKER.length) continue;
      included = `${body.slice(0, remaining - NOTE_CUT_MARKER.length).trimEnd()}${NOTE_CUT_MARKER}`;
    }

    const updated = tryParseNoteTimestamp(note.updatedAt);
    const updatedLabel = updated ? ` (updated ${formatChatDate(updated)})` : '';
    blocks.push(`### ${note.title}${updatedLabel}\n${included}`);
    sources.push({ noteId: note.id, title: note.title });
    remaining -= included.length;
  }

  return { section: blocks.length > 0 ? blocks.join('\n\n') : 'No matching notes.', sources };
};

export const buildChatPayload = (input: ChatPayloadInput): ChatPayload => {
  const {
    question,
    history,
    notes,
    calendar,
    now,
    noteCharBudget = CHAT_NOTE_CHAR_BUDGET,
    transcripts,
  } = input;
  const today = now.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const { section: notesSection, sources } = formatNotesSection(notes, noteCharBudget, transcripts);

  const text = [
    `TODAY:\n${today}`,
    `CALENDAR (next 48 hours):\n${formatCalendarSection(calendar, now)}`,
    `NOTES:\n${notesSection}`,
    `RECENT CHAT:\n${formatChatHistory(history)}`,
    `USER QUESTION:\n${question.trim()}`,
  ].join('\n\n');

  return { systemPrompt: CHAT_SYSTEM_PROMPT, text, sources };
};
