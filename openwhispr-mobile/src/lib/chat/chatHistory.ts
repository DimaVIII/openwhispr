import { chatRepository } from '@/data';
import { Sentry } from '@/lib/sentry';
import { useChatStore } from '@/store/useChatStore';

// The store goes first: its reset aborts the running turn, so no late answer lands after the wipe.
// A failed wipe is logged rather than thrown, so it can't leave a sign-out, an account deletion or
// an account switch half done.
export const clearChatHistory = (): void => {
  try {
    useChatStore.getState().reset();
    chatRepository.clearAll();
  } catch (error) {
    console.warn('[chat] chat history was not cleared:', error);
    Sentry.captureException(error, {
      level: 'warning',
      tags: { feature: 'chat', operation: 'clear-history' },
    });
  }
};
