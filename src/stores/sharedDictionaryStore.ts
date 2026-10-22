import { create } from "zustand";
import type { SharedDictionarySnapshot } from "../types/sharedDictionary";
import { EMPTY_SHARED_HINTS, selectSharedHintWords } from "../utils/sharedDictionaryHints";
import logger from "../utils/logger";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";

export type ListKey = "all" | "personal" | "allShared" | "workspace" | `space:${string}` | "hidden";

// ssoRequired and noAccess describe the active workspace: its last pass was
// refused for company SSO, or the member can no longer read its lists.
export type SharedDictionaryStatus = "unavailable" | "ready" | "ssoRequired" | "noAccess";

type AccessStatus = Extract<SharedDictionaryStatus, "ssoRequired" | "noAccess">;

// "false" once the API answered the shared dictionary routes with a plain 404
// (not deployed yet); any successful pass writes "true".
export const SHARED_DICTIONARY_CAPABILITY_KEY = "sharedDictionaryCapability";
// { [workspaceId]: status } of each workspace's last refused pass, until a
// pass for it succeeds. Shared by every window (see the storage listener below).
export const SHARED_DICTIONARY_ACCESS_KEY = "sharedDictionaryAccess";

const isAccessStatus = (status: unknown): status is AccessStatus =>
  status === "ssoRequired" || status === "noAccess";

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

function readAccessMap(): Record<string, AccessStatus> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SHARED_DICTIONARY_ACCESS_KEY) ?? "{}");
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, AccessStatus] =>
        isAccessStatus(entry[1])
      )
    );
  } catch {
    return {};
  }
}

function writeAccessStatus(workspaceId: string, status: AccessStatus | null): void {
  const map = readAccessMap();
  if (status) map[workspaceId] = status;
  else delete map[workspaceId];
  if (Object.keys(map).length === 0) localStorage.removeItem(SHARED_DICTIONARY_ACCESS_KEY);
  else localStorage.setItem(SHARED_DICTIONARY_ACCESS_KEY, JSON.stringify(map));
}

function readAccessStatus(workspaceId: string | null): AccessStatus | null {
  if (!workspaceId || typeof localStorage === "undefined") return null;
  return readAccessMap()[workspaceId] ?? null;
}

function readStatus(workspaceId: string | null): SharedDictionaryStatus {
  if (typeof localStorage === "undefined") return "ready";
  if (localStorage.getItem(SHARED_DICTIONARY_CAPABILITY_KEY) === "false") return "unavailable";
  return readAccessStatus(workspaceId) ?? "ready";
}

export const useSharedDictionaryStore = create<SharedDictionaryState>((set, get) => {
  const isCurrent = (workspaceId: string | null, generation: number): boolean =>
    get().generation === generation && get().workspaceId === workspaceId;

  return {
    workspaceId: useWorkspaceStore.getState().activeWorkspaceId,
    status: readStatus(useWorkspaceStore.getState().activeWorkspaceId),
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
        .setSharedDictionaryHints(
          selectSharedHintWords(snapshot, movedPersonal ?? []),
          workspaceId
        );
    },

    reload: () => get().load(get().workspaceId, get().generation),

    handleScopeChange: (workspaceId) => {
      const generation = get().generation + 1;
      const { status } = get();
      set({
        workspaceId,
        generation,
        // An access status belongs to the workspace it was refused for.
        status: status === "unavailable" ? status : (readAccessStatus(workspaceId) ?? "ready"),
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
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(SHARED_DICTIONARY_ACCESS_KEY);
      }
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
      set({ status });
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(
          SHARED_DICTIONARY_CAPABILITY_KEY,
          status === "unavailable" ? "false" : "true"
        );
        const { workspaceId } = get();
        if (workspaceId && status !== "unavailable") {
          writeAccessStatus(workspaceId, isAccessStatus(status) ? status : null);
        }
      } catch {
        // The status still applies for this session.
      }
    },

    setSyncing: (syncing) => set({ syncing }),
  };
});

// A pass in another window (often the dictation overlay) wrote a status:
// follow it for this window's workspace.
export function handleSharedDictionaryStatusStorage(event: StorageEvent): void {
  if (
    event.key !== SHARED_DICTIONARY_ACCESS_KEY &&
    event.key !== SHARED_DICTIONARY_CAPABILITY_KEY
  ) {
    return;
  }
  const state = useSharedDictionaryStore.getState();
  const status = readStatus(state.workspaceId);
  if (status !== state.status) useSharedDictionaryStore.setState({ status });
}

// Registered once for the window's lifetime, like the store itself.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", handleSharedDictionaryStatusStorage);
}

// Every change of the active workspace (setActiveWorkspaceId, refresh()'s
// auto-select and clear, resetForAccountChange) switches the shared lists.
useWorkspaceStore.subscribe((state, previous) => {
  if (state.activeWorkspaceId !== previous.activeWorkspaceId) {
    useSharedDictionaryStore.getState().handleScopeChange(state.activeWorkspaceId);
  }
});
