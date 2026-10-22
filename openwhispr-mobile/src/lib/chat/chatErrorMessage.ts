import { isLocalContextLimitError, LocalReasoningError } from '@/lib/localReasoning';

export const CHAT_CONNECTION_ERROR_MESSAGE = 'Check your connection and try again.';
export const CHAT_ON_DEVICE_UNAVAILABLE_MESSAGE = 'On-device AI isn’t available right now.';
export const CHAT_CONTEXT_LIMIT_MESSAGE =
  'This question needs more context than on-device AI can handle. Try a shorter question or start a new chat.';

const ORGANIZATION_POLICY_PREFIX = 'Your organization';

// Provider and network errors carry raw text that means nothing to the user, so only the cases
// with something to act on get their own copy; timeouts, fetch failures and the rest read as a
// connection problem.
export const toChatErrorMessage = (error: unknown): string => {
  if (isLocalContextLimitError(error)) return CHAT_CONTEXT_LIMIT_MESSAGE;
  if (
    error instanceof LocalReasoningError &&
    (error.code === 'LOCAL_REASONING_UNAVAILABLE' || error.code === 'APPLE_LLM_UNAVAILABLE')
  ) {
    return CHAT_ON_DEVICE_UNAVAILABLE_MESSAGE;
  }
  if (error instanceof Error && error.message.startsWith(ORGANIZATION_POLICY_PREFIX)) {
    return error.message;
  }
  return CHAT_CONNECTION_ERROR_MESSAGE;
};
