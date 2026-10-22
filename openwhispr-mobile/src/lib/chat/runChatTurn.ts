import type { GoogleCalendarAccount, GoogleCalendarEvent, Note } from '@/data';
import type { InferenceSelection } from '@/lib/mobileProviders';
import { isLocalContextLimitError } from '@/lib/localReasoning';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import type { ReasoningResponse, ReasoningRoutingOptions } from '@/types';
import {
  buildChatPayload,
  extractSearchTerms,
  formatChatTime,
  rankChatNotes,
  utcDateAsLocalDay,
  type ChatPayload,
} from './chatContext';
import type { ChatMessage, ChatSource, ChatStep } from './types';

const CANDIDATE_POOL_LIMIT = 50;
const MAX_MATCHED_NOTES = 4;
const MIN_CHAT_NOTES = 2;
const CONTEXT_LIMIT_NOTE_CHAR_BUDGET = 3_000;

export interface ChatTurnInput {
  question: string;
  history: ChatMessage[];
  signal: AbortSignal;
  allowCloudFallback: boolean;
  onSteps: (steps: ChatStep[]) => void;
  now?: Date;
}

export interface ChatTurnResult {
  text: string;
  steps: ChatStep[];
  sources: ChatSource[];
}

export interface ChatModelRequest {
  systemPrompt: string;
  text: string;
  signal?: AbortSignal;
  routing?: ReasoningRoutingOptions;
}

export interface ChatTurnDeps {
  getCandidateNotes: (
    terms: string[],
    options: { includePrivate: boolean; limit: number },
  ) => Note[];
  getConnectedCalendarAccounts: () => GoogleCalendarAccount[];
  getCalendarEvents: (accounts: GoogleCalendarAccount[], now: Date) => GoogleCalendarEvent[];
  chat: (request: ChatModelRequest) => Promise<ReasoningResponse>;
  getChatMode: () => InferenceSelection['mode'] | undefined;
}

// Required lazily, as ReasoningService does, so importing this module doesn't pull SQLite and the
// stores into the chat store's import graph.
const createDefaultChatTurnDeps = (): ChatTurnDeps => ({
  getCandidateNotes: (terms, options) => {
    const { notesRepository } = require('@/data') as typeof import('@/data');
    return notesRepository.getChatCandidateNotes(terms, options);
  },
  getConnectedCalendarAccounts: () => {
    const { useGoogleCalendarStore } =
      require('@/store/useGoogleCalendarStore') as typeof import('@/store/useGoogleCalendarStore');
    return useGoogleCalendarStore
      .getState()
      .accounts.filter((account) => account.status === 'connected');
  },
  getCalendarEvents: (accounts, now) => {
    const { calendarRepository } = require('@/data') as typeof import('@/data');
    const { getMeetingCalendarEventSuggestions } =
      require('@/lib/calendar/meetingSuggestions') as typeof import('@/lib/calendar/meetingSuggestions');
    return getMeetingCalendarEventSuggestions(accounts, calendarRepository, now);
  },
  chat: (request) => {
    const { ReasoningService } =
      require('@/services/reasoning/ReasoningService') as typeof import('@/services/reasoning/ReasoningService');
    return ReasoningService.chat(request);
  },
  getChatMode: () => {
    const { getInferenceSelection } =
      require('@/lib/inferenceRouting') as typeof import('@/lib/inferenceRouting');
    return getInferenceSelection('noteChat')?.mode;
  },
});

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};

const hasEnded = (event: GoogleCalendarEvent, now: Date): boolean => {
  const end = tryParseNoteTimestamp(event.endAt);
  if (!end) return true;
  if (!event.allDay) return end.getTime() <= now.getTime();
  // An all-day endAt is the exclusive end date at UTC midnight, so compare calendar days.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return utcDateAsLocalDay(end).getTime() <= today.getTime();
};

const describeNextEvent = (events: GoogleCalendarEvent[], now: Date): string => {
  const next = events.find((event) => !hasEnded(event, now));
  if (!next) return 'No meetings coming up';

  const summary = next.summary?.trim() || 'Untitled meeting';
  if (next.allDay) return `${summary} · all day`;
  const start = tryParseNoteTimestamp(next.startAt);
  return start ? `${summary} · ${formatChatTime(start)}` : summary;
};

const describeMatches = (count: number): string => {
  if (count === 0) return 'No matching notes';
  if (count === 1) return '1 note matches';
  return `${count} notes match`;
};

const describeReading = (sources: ChatSource[]): { active: string; done: string } => {
  const title = `“${sources[0].title}”`;
  const more = sources.length > 1 ? ` and ${sources.length - 1} more` : '';
  return { active: `Reading ${title}${more}…`, done: `Read ${title}${more}` };
};

export async function runChatTurn(
  input: ChatTurnInput,
  deps: ChatTurnDeps = createDefaultChatTurnDeps(),
): Promise<ChatTurnResult> {
  const { question, history, signal, allowCloudFallback, onSteps, now = new Date() } = input;
  const steps: ChatStep[] = [];
  const setStep = (step: ChatStep): void => {
    const index = steps.findIndex((existing) => existing.id === step.id);
    if (index === -1) steps.push(step);
    else steps[index] = step;
    onSteps([...steps]);
  };

  throwIfAborted(signal);
  const includePrivate = deps.getChatMode() === 'local';
  // The repository already filters private notes; this keeps them out whatever it returns.
  const allowed = (notes: Note[]): Note[] =>
    includePrivate ? notes : notes.filter((note) => note.isPrivate !== 1);

  let calendar: GoogleCalendarEvent[] | null = null;
  const accounts = deps.getConnectedCalendarAccounts();
  if (accounts.length > 0) {
    setStep({ id: 'calendar', status: 'active', label: 'Checking your calendar…' });
    calendar = deps.getCalendarEvents(accounts, now);
    setStep({
      id: 'calendar',
      status: 'done',
      label: 'Checked your calendar',
      detail: describeNextEvent(calendar, now),
    });
    throwIfAborted(signal);
  }

  setStep({ id: 'search', status: 'active', label: 'Searching your notes…' });
  const terms = extractSearchTerms(question);
  const matches =
    terms.length > 0
      ? allowed(deps.getCandidateNotes(terms, { includePrivate, limit: CANDIDATE_POOL_LIMIT }))
      : [];
  const notes = rankChatNotes(matches, terms).slice(0, MAX_MATCHED_NOTES);
  if (notes.length < MIN_CHAT_NOTES) {
    const matchedIds = new Set(notes.map((note) => note.id));
    // Asking for enough to cover the matches already held still leaves room for the fill.
    const recent = allowed(
      deps.getCandidateNotes([], { includePrivate, limit: MIN_CHAT_NOTES + notes.length }),
    ).filter((note) => !matchedIds.has(note.id));
    notes.push(...recent.slice(0, MIN_CHAT_NOTES - notes.length));
  }
  setStep({
    id: 'search',
    status: 'done',
    label: 'Searched your notes',
    detail: describeMatches(matches.length),
  });
  throwIfAborted(signal);

  const buildPayload = (payloadNotes: Note[], noteCharBudget?: number): ChatPayload =>
    buildChatPayload({ question, history, notes: payloadNotes, calendar, now, noteCharBudget });
  let payload = buildPayload(notes);

  if (payload.sources.length > 0) {
    const reading = describeReading(payload.sources);
    setStep({ id: 'read', status: 'active', label: reading.active });
    setStep({ id: 'read', status: 'done', label: reading.done });
  }

  setStep({ id: 'write', status: 'active', label: 'Writing your answer…' });
  // A failure after an abort reports the abort, so the caller never shows it as an error.
  const send = async (request: ChatPayload): Promise<ReasoningResponse> => {
    try {
      return await deps.chat({
        systemPrompt: request.systemPrompt,
        text: request.text,
        signal,
        routing: { allowCloudFallback },
      });
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    }
  };

  let response: ReasoningResponse;
  try {
    response = await send(payload);
  } catch (error) {
    if (!isLocalContextLimitError(error)) throw error;
    payload = buildPayload(notes.slice(0, 1), CONTEXT_LIMIT_NOTE_CHAR_BUDGET);
    response = await send(payload);
  }
  throwIfAborted(signal);

  setStep({ id: 'write', status: 'done', label: 'Wrote the answer' });
  return { text: response.text, steps: [...steps], sources: payload.sources };
}
