import type { GoogleCalendarAccount, GoogleCalendarEvent, Note } from '@/data';
import type { InferenceRoute, InferenceSelection } from '@/lib/mobileProviders';
import { isLocalContextLimitError } from '@/lib/localReasoning';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';
import type { ReasoningResponse, ReasoningRoutingOptions } from '@/types';
import {
  buildChatPayload,
  extractSearchTerms,
  formatChatTime,
  isInChatCalendarWindow,
  rankChatNotes,
  type ChatPayload,
} from './chatContext';
import type { ChatMessage, ChatSource, ChatStep, ChatStepId } from './types';

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
  inferenceRoute?: InferenceRoute;
}

export interface ChatTurnDeps {
  getCandidateNotes: (
    terms: string[],
    options: { includePrivate: boolean; limit: number },
  ) => Note[];
  isNotePrivate: (noteId: number) => boolean;
  getConnectedCalendarAccounts: () => GoogleCalendarAccount[];
  getCalendarEvents: (accounts: GoogleCalendarAccount[], now: Date) => GoogleCalendarEvent[];
  chat: (request: ChatModelRequest) => Promise<ReasoningResponse>;
  getChatSelection: () => InferenceSelection | undefined;
}

// Required lazily, as ReasoningService does, so importing this module doesn't pull SQLite and the
// stores into the chat store's import graph.
const createDefaultChatTurnDeps = (): ChatTurnDeps => ({
  getCandidateNotes: (terms, options) => {
    const { notesRepository } = require('@/data') as typeof import('@/data');
    return notesRepository.getChatCandidateNotes(terms, options);
  },
  isNotePrivate: (noteId) => {
    const { notesRepository } = require('@/data') as typeof import('@/data');
    return notesRepository.getNoteById(noteId)?.isPrivate === 1;
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
  getChatSelection: () => {
    const { getInferenceSelection } =
      require('@/lib/inferenceRouting') as typeof import('@/lib/inferenceRouting');
    return getInferenceSelection('noteChat');
  },
});

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};

// ReasoningService treats an inferenceRoute as the selection it would otherwise look up, and
// validates a provider route itself, so this only gives the selection the route's shape. No
// selection means OpenWhispr Cloud, which is what ReasoningService.chat does without one.
const toChatRoute = (selection: InferenceSelection | undefined): InferenceRoute => {
  if (selection?.mode !== 'providers') {
    return { mode: selection?.mode ?? 'openwhispr', scope: 'noteChat' };
  }
  return {
    ...selection,
    mode: 'providers',
    scope: 'noteChat',
    providerId: selection.providerId ?? '',
    modelId: selection.modelId ?? '',
    endpoint: selection.endpoint ?? '',
  };
};

// An answer built from a note that is private now carries that note's content, so it leaves the
// history together with the question that asked for it.
const withoutPrivateAnswers = (
  history: ChatMessage[],
  isNotePrivate: (noteId: number) => boolean,
): ChatMessage[] => {
  const dropped = new Set<number>();
  history.forEach((message, index) => {
    if (message.role !== 'assistant') return;
    if (!message.sources.some((source) => isNotePrivate(source.noteId))) return;
    dropped.add(index);
    if (history[index - 1]?.role === 'user') dropped.add(index - 1);
  });
  return history.filter((_, index) => !dropped.has(index));
};

// A calendar that can't be read counts as none connected, so the notes can still answer.
const readAccounts = (deps: ChatTurnDeps): GoogleCalendarAccount[] => {
  try {
    return deps.getConnectedCalendarAccounts();
  } catch {
    return [];
  }
};

const readEvents = (
  deps: ChatTurnDeps,
  accounts: GoogleCalendarAccount[],
  now: Date,
): GoogleCalendarEvent[] | null => {
  try {
    return deps.getCalendarEvents(accounts, now);
  } catch {
    return null;
  }
};

const describeNextEvent = (events: GoogleCalendarEvent[], now: Date): string => {
  const next = events.find((event) => isInChatCalendarWindow(event, now));
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
  const { question, signal, allowCloudFallback, onSteps, now = new Date() } = input;
  const steps: ChatStep[] = [];
  const setStep = (step: ChatStep): void => {
    const index = steps.findIndex((existing) => existing.id === step.id);
    if (index === -1) steps.push(step);
    else steps[index] = step;
    onSteps([...steps]);
  };
  const removeStep = (id: ChatStepId): void => {
    const index = steps.findIndex((existing) => existing.id === id);
    if (index === -1) return;
    steps.splice(index, 1);
    onSteps([...steps]);
  };

  throwIfAborted(signal);
  // Read once, so the notes picked for this route and the route that receives them can't diverge.
  const selection = deps.getChatSelection();
  const inferenceRoute = toChatRoute(selection);
  const includePrivate = selection?.mode === 'local';
  // The repository already filters private notes; this keeps them out whatever it returns.
  const allowed = (notes: Note[]): Note[] =>
    includePrivate ? notes : notes.filter((note) => note.isPrivate !== 1);
  const history = includePrivate
    ? input.history
    : withoutPrivateAnswers(input.history, deps.isNotePrivate);

  let calendar: GoogleCalendarEvent[] | null = null;
  const accounts = readAccounts(deps);
  if (accounts.length > 0) {
    setStep({ id: 'calendar', status: 'active', label: 'Checking your calendar…' });
    calendar = readEvents(deps, accounts, now);
    if (calendar === null) {
      removeStep('calendar');
    } else {
      setStep({
        id: 'calendar',
        status: 'done',
        label: 'Checked your calendar',
        detail: describeNextEvent(calendar, now),
      });
    }
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

  const privateNoteIds = new Set(
    notes.filter((note) => note.isPrivate === 1).map((note) => note.id),
  );
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
    const isPrivateNote = request.sources.some((source) => privateNoteIds.has(source.noteId));
    try {
      return await deps.chat({
        systemPrompt: request.systemPrompt,
        text: request.text,
        signal,
        routing: isPrivateNote ? { allowCloudFallback, isPrivateNote } : { allowCloudFallback },
        inferenceRoute,
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
    // The first payload always reads at least the note the retry keeps, so the read step is
    // already in place before the write step and is relabelled there.
    if (payload.sources.length > 0) {
      setStep({ id: 'read', status: 'done', label: describeReading(payload.sources).done });
    } else {
      removeStep('read');
    }
    response = await send(payload);
  }
  throwIfAborted(signal);

  setStep({ id: 'write', status: 'done', label: 'Wrote the answer' });
  return { text: response.text, steps: [...steps], sources: payload.sources };
}
