import { create } from 'zustand';
import { chatRepository } from '@/data';
import { runChatTurn } from '@/lib/chat/runChatTurn';
import type { ChatConversationSummary, ChatMessage, ChatStep } from '@/lib/chat/types';

const TITLE_MAX_LENGTH = 60;
const FALLBACK_FAILURE_MESSAGE = 'Check your connection and try again.';

export interface ChatPending {
  // null while transcribing a question for a chat that doesn't exist yet.
  conversationId: string | null;
  phase: 'transcribing' | 'working';
  steps: ChatStep[];
  startedAt: number;
}

export interface ChatFailure {
  conversationId: string;
  messageId: string;
  question: string;
  message: string;
}

export interface ChatSendOptions {
  conversationId: string | null;
  allowCloudFallback: boolean;
}

export interface ChatSendResult {
  conversationId: string;
  done: Promise<void>;
}

interface ChatState {
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  pending: ChatPending | null;
  failure: ChatFailure | null;
  loadConversations: () => void;
  openConversation: (id: string) => void;
  closeConversation: () => void;
  beginTranscribing: (conversationId: string | null) => boolean;
  endTranscribing: () => void;
  send: (question: string, options: ChatSendOptions) => ChatSendResult | null;
  retry: (options: { allowCloudFallback: boolean }) => Promise<void>;
  editFailedQuestion: () => string | null;
  cancel: () => void;
  deleteConversation: (id: string) => void;
  reset: () => void;
}

interface TurnRequest {
  conversationId: string;
  userMessageId: string;
  question: string;
  history: ChatMessage[];
  allowCloudFallback: boolean;
}

const INITIAL_STATE: Pick<
  ChatState,
  'conversations' | 'activeConversationId' | 'messages' | 'pending' | 'failure'
> = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  pending: null,
  failure: null,
};

// One turn runs at a time across every conversation. Bumping the generation orphans whatever is
// in flight, so a result that lands after a cancel, reset or delete never writes anything.
const turn: { controller: AbortController | null; generation: number } = {
  controller: null,
  generation: 0,
};

const abortTurn = (): void => {
  turn.generation += 1;
  turn.controller?.abort();
  turn.controller = null;
};

const toConversationTitle = (question: string): string => {
  const collapsed = question.replace(/\s+/g, ' ').trim();
  // Counted by code point, so the cut never splits an emoji's surrogate pair.
  const characters = Array.from(collapsed);
  return characters.length > TITLE_MAX_LENGTH
    ? `${characters.slice(0, TITLE_MAX_LENGTH).join('')}…`
    : collapsed;
};

const toFailureMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : FALLBACK_FAILURE_MESSAGE;

export const useChatStore = create<ChatState>((set, get) => {
  const runTurn = async (request: TurnRequest): Promise<void> => {
    const controller = new AbortController();
    turn.generation += 1;
    turn.controller = controller;
    const generation = turn.generation;
    const isCurrent = (): boolean => generation === turn.generation;

    set({
      pending: {
        conversationId: request.conversationId,
        phase: 'working',
        steps: [],
        startedAt: Date.now(),
      },
    });

    try {
      const result = await runChatTurn({
        question: request.question,
        history: request.history,
        signal: controller.signal,
        allowCloudFallback: request.allowCloudFallback,
        onSteps: (steps) => {
          if (!isCurrent()) return;
          set((state) => (state.pending ? { pending: { ...state.pending, steps } } : {}));
        },
      });
      if (!isCurrent()) return;
      turn.controller = null;
      const saved = chatRepository.appendMessage({
        conversationId: request.conversationId,
        role: 'assistant',
        text: result.text,
        steps: result.steps,
        sources: result.sources,
      });
      set((state) => ({
        pending: null,
        conversations: chatRepository.listConversations(),
        messages:
          state.activeConversationId === request.conversationId
            ? [...state.messages, saved]
            : state.messages,
      }));
    } catch (error) {
      if (!isCurrent()) return;
      // Cancel and reset already orphaned their turn, so anything reaching here, an AbortError
      // included, is a real failure the user can retry.
      turn.controller = null;
      set({
        pending: null,
        failure: {
          conversationId: request.conversationId,
          messageId: request.userMessageId,
          question: request.question,
          message: toFailureMessage(error),
        },
      });
    }
  };

  return {
    ...INITIAL_STATE,

    loadConversations: () => {
      set({ conversations: chatRepository.listConversations() });
    },

    openConversation: (id) => {
      set({ activeConversationId: id, messages: chatRepository.getMessages(id) });
    },

    closeConversation: () => {
      set({ activeConversationId: null, messages: [] });
    },

    beginTranscribing: (conversationId) => {
      if (get().pending) return false;
      set({ pending: { conversationId, phase: 'transcribing', steps: [], startedAt: Date.now() } });
      return true;
    },

    endTranscribing: () => {
      if (get().pending?.phase === 'transcribing') set({ pending: null });
    },

    send: (question, options) => {
      const text = question.trim();
      if (!text || get().pending?.phase === 'working') return null;
      // A screen can still hold the id of a conversation deleted under it.
      if (options.conversationId && !chatRepository.getConversation(options.conversationId)) {
        return null;
      }

      const conversationId =
        options.conversationId ?? chatRepository.createConversation(toConversationTitle(text)).id;
      const history = chatRepository.getMessages(conversationId);
      const userMessage = chatRepository.appendMessage({ conversationId, role: 'user', text });
      set((state) => ({
        failure: null,
        conversations: chatRepository.listConversations(),
        messages:
          state.activeConversationId === conversationId
            ? [...state.messages, userMessage]
            : state.messages,
      }));

      const done = runTurn({
        conversationId,
        userMessageId: userMessage.id,
        question: text,
        history,
        allowCloudFallback: options.allowCloudFallback,
      });
      return { conversationId, done };
    },

    retry: async ({ allowCloudFallback }) => {
      const { failure, pending } = get();
      if (!failure || pending) return;

      const stored = chatRepository.getMessages(failure.conversationId);
      const index = stored.findIndex((message) => message.id === failure.messageId);
      set({ failure: null });
      if (index === -1) return;

      await runTurn({
        conversationId: failure.conversationId,
        userMessageId: failure.messageId,
        question: failure.question,
        history: stored.slice(0, index),
        allowCloudFallback,
      });
    },

    editFailedQuestion: () => {
      const { failure } = get();
      if (!failure) return null;

      chatRepository.deleteMessage(failure.messageId);
      set((state) => ({
        failure: null,
        conversations: chatRepository.listConversations(),
        messages: state.messages.filter((message) => message.id !== failure.messageId),
      }));
      return failure.question;
    },

    cancel: () => {
      abortTurn();
      set({ pending: null });
    },

    deleteConversation: (id) => {
      if (get().pending?.conversationId === id) get().cancel();
      chatRepository.deleteConversation(id);
      set((state) => ({
        conversations: chatRepository.listConversations(),
        failure: state.failure?.conversationId === id ? null : state.failure,
        ...(state.activeConversationId === id ? { activeConversationId: null, messages: [] } : {}),
      }));
    },

    reset: () => {
      abortTurn();
      set(INITIAL_STATE);
    },
  };
});
