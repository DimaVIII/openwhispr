import { create } from 'zustand';
import { selectSharedHintWords, type SharedHintWords } from '@/lib/sharedDictionaryHints';

// The sync modules are required where they're used: src/lib/dictationHints.ts
// imports this store and is imported by every dictation path, so a static
// import of `@/sync/*` would drag the data layer (and `expo/fetch`) into all of
// them and break test isolation.

export interface SharedDictionarySummary {
  count: number;
  workspaceName: string;
}

interface SharedDictionaryStoreState {
  /** The shared words that apply to dictation, by tier. */
  hints: SharedHintWords;
  /**
   * lower(word) of every live shared entry, hidden or not: a personal word
   * moved into a shared list leaves the personal list while its shared copy
   * exists, even when the member hid that copy. Empty while sharing is paused.
   */
  sharedWordsLower: Set<string>;
  /** How many shared words apply, or null when none do. */
  summary: SharedDictionarySummary | null;
  load: () => Promise<void>;
  reset: () => void;
}

const emptyState = (): Pick<
  SharedDictionaryStoreState,
  'hints' | 'sharedWordsLower' | 'summary'
> => ({
  hints: { space: [], workspace: [] },
  sharedWordsLower: new Set(),
  summary: null,
});

// Bumped by reset(): a load that started for the previous account must not
// publish that account's words after a sign-out or account switch.
let generation = 0;

export const useSharedDictionaryStore = create<SharedDictionaryStoreState>((set) => ({
  ...emptyState(),

  load: async () => {
    const startedAt = generation;
    const { loadSharedDictionaryState } =
      require('@/sync/sharedDictionaryState') as typeof import('@/sync/sharedDictionaryState');
    const state = await loadSharedDictionaryState();
    if (startedAt !== generation) return;
    if (!state) {
      set(emptyState());
      return;
    }
    const hints = selectSharedHintWords(state);
    const count = hints.space.length + hints.workspace.length;
    set({
      hints,
      // While paused the words apply at personal priority, so the Personal
      // list keeps showing them.
      sharedWordsLower: state.paused
        ? new Set()
        : new Set(Object.values(state.entries).map((entry) => entry.word.trim().toLowerCase())),
      summary: count > 0 ? { count, workspaceName: state.workspaceName } : null,
    });
  },

  reset: () => {
    generation += 1;
    set(emptyState());
  },
}));

/**
 * Loads the stored shared words, but only for the account they were pulled
 * under. Sign-out resets the store and leaves `shared_dictionary.state` in
 * SQLite until the next account switch wipes it, so an ungated load could apply
 * the previous account's words. Pass the signed-in, non-guest user's id, or null.
 */
export function loadSharedDictionaryIfOwnedBy(userId: string | null): Promise<void> {
  const { getLastSyncedUserId } =
    require('@/sync/syncIdentity') as typeof import('@/sync/syncIdentity');
  if (!userId || getLastSyncedUserId() !== userId) return Promise.resolve();
  return useSharedDictionaryStore.getState().load();
}
