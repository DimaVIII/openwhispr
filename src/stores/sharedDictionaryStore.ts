import { create } from "zustand";
import type { SharedDictionarySnapshot } from "../types/sharedDictionary";
import { EMPTY_SHARED_HINTS, selectSharedHintWords } from "../utils/sharedDictionaryHints";
import logger from "../utils/logger";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";

export type ListKey = "all" | "personal" | "allShared" | "workspace" | `space:${string}` | "hidden";

export type SharedDictionaryStatus = "unavailable" | "ready";

// "false" once the API answered the shared dictionary routes with a plain 404
// (not deployed yet); any successful pass writes "true".
export const SHARED_DICTIONARY_CAPABILITY_KEY = "sharedDictionaryCapability";

interface SharedDictionaryState {
  workspaceId: string | null;
  status: SharedDictionaryStatus;
  snapshot: SharedDictionarySnapshot | null;
  syncing: boolean;
  lastSyncedAt: string | null;
  // Set by the arrival toast's "View words".
  requestedList: ListKey | null;
  // Personal words whose row was shared into a team list.
  movedPersonal: string[];
  // Bumped on every account or active-workspace change; work started under an
  // older generation never publishes.
  generation: number;
  load: (workspaceId: string | null, generation: number) => Promise<void>;
  reload: () => Promise<void>;
  handleScopeChange: (workspaceId: string | null) => void;
  resetForAccountChange: () => void;
  setRequestedList: (list: ListKey | null) => void;
  setStatus: (status: SharedDictionaryStatus) => void;
  setSyncing: (syncing: boolean) => void;
}

function readStatus(): SharedDictionaryStatus {
  if (typeof localStorage === "undefined") return "ready";
  return localStorage.getItem(SHARED_DICTIONARY_CAPABILITY_KEY) === "false"
    ? "unavailable"
    : "ready";
}

export const useSharedDictionaryStore = create<SharedDictionaryState>((set, get) => {
  const isCurrent = (workspaceId: string | null, generation: number): boolean =>
    get().generation === generation && get().workspaceId === workspaceId;

  return {
    workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
    status: readStatus(),
    snapshot: null,
    syncing: false,
    lastSyncedAt: null,
    requestedList: null,
    movedPersonal: [],
    generation: 0,

    load: async (workspaceId, generation) => {
      if (!workspaceId) {
        if (!isCurrent(workspaceId, generation)) return;
        set({ snapshot: null, movedPersonal: [], lastSyncedAt: null });
        useSettingsStore.getState().setSharedDictionaryHints(EMPTY_SHARED_HINTS, null);
        return;
      }
      const api = window.electronAPI;
      let snapshot: SharedDictionarySnapshot | undefined;
      let movedPersonal: string[] | undefined;
      try {
        [snapshot, movedPersonal] = await Promise.all([
          api?.getSharedDictionary?.(workspaceId),
          api?.getMovedDictionaryWords?.(),
        ]);
      } catch (error) {
        logger.warn(
          "Failed to load the shared dictionary",
          { error: (error as Error)?.message },
          "dictionary"
        );
        return;
      }
      if (!snapshot || !isCurrent(workspaceId, generation)) return;
      set({
        snapshot,
        movedPersonal: movedPersonal ?? [],
        lastSyncedAt: snapshot.meta?.syncedAt ?? null,
      });
      useSettingsStore
        .getState()
        .setSharedDictionaryHints(selectSharedHintWords(snapshot), workspaceId);
    },

    reload: () => get().load(get().workspaceId, get().generation),

    handleScopeChange: (workspaceId) => {
      const generation = get().generation + 1;
      set({
        workspaceId,
        generation,
        snapshot: null,
        movedPersonal: [],
        lastSyncedAt: null,
        requestedList: null,
        syncing: false,
      });
      // Emptied before the load so the old workspace's words never reach a
      // dictation that starts in between; this also resends them to main.
      useSettingsStore.getState().setSharedDictionaryHints(EMPTY_SHARED_HINTS, workspaceId);
      void get().load(workspaceId, generation);
    },

    // The tables and cursors are cleared by the caller (SyncService). The
    // workspace stays whatever workspaceStore holds, so a load for it after
    // the reset still publishes.
    resetForAccountChange: () => {
      set((state) => ({
        generation: state.generation + 1,
        status: "ready",
        snapshot: null,
        movedPersonal: [],
        lastSyncedAt: null,
        requestedList: null,
        syncing: false,
      }));
      useSettingsStore.getState().setSharedDictionaryHints(EMPTY_SHARED_HINTS, null);
    },

    setRequestedList: (requestedList) => set({ requestedList }),

    setStatus: (status) => {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          SHARED_DICTIONARY_CAPABILITY_KEY,
          status === "unavailable" ? "false" : "true"
        );
      }
      set({ status });
    },

    setSyncing: (syncing) => set({ syncing }),
  };
});

// Every change of the active workspace (setActiveWorkspaceId, refresh()'s
// auto-select and clear, resetForAccountChange) switches the shared lists.
useWorkspaceStore.subscribe((state, previous) => {
  if (state.activeWorkspaceId !== previous.activeWorkspaceId) {
    useSharedDictionaryStore.getState().handleScopeChange(state.activeWorkspaceId);
  }
});
