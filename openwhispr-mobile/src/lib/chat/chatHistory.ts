import { chatRepository } from '@/data';
import { useChatStore } from '@/store/useChatStore';

// The store goes first: its reset aborts the running turn, so no late answer lands after the wipe.
export const clearChatHistory = (): void => {
  useChatStore.getState().reset();
  chatRepository.clearAll();
};
