import { CloudApiError } from "./cloudApi";
import { MAX_SHARED_DICTIONARY_BATCH, SharedDictionaryService } from "./SharedDictionaryService";
import { syncService } from "./SyncService";
import { useSettingsStore } from "../stores/settingsStore";
import { useSharedDictionaryStore } from "../stores/sharedDictionaryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type {
  CloudSharedEntry,
  CloudSharedHide,
  SharedDictionaryShareResponse,
} from "../types/sharedDictionary";
import logger from "../utils/logger";

// Writes to shared lists go online first and then apply the server's answer to
// the local mirror, so they work from any window (control panel or dictation)
// without waiting for the next sync pass.

// A space id, or null for the workspace-wide list.
export type ShareTarget = string | null;

export type SharedDictionaryActionReason =
  | "alreadyInList"
  | "personalChanged"
  | "planRequired"
  | "ssoRequired"
  | "notMember"
  | "listFull"
  | "network";

export class SharedDictionaryActionError extends Error {
  reason: SharedDictionaryActionReason;
  // The personal words the server saw renamed or deleted (personalChanged only).
  conflicts: Array<{ id: string; word: string }>;
  // A batched delete or hide that failed part-way: how many entries the chunks
  // before the failure changed, and (delete only) how to restore them.
  appliedCount = 0;
  undo?: () => Promise<void>;
  constructor(
    reason: SharedDictionaryActionReason,
    message: string,
    conflicts: Array<{ id: string; word: string }> = []
  ) {
    super(message);
    this.name = "SharedDictionaryActionError";
    this.reason = reason;
    this.conflicts = conflicts;
  }
}

export interface ActionFailure {
  words: string[];
  reason: SharedDictionaryActionReason;
}

const REASON_BY_CODE: Record<string, SharedDictionaryActionReason> = {
  SHARED_DICTIONARY_ALREADY_IN_LIST: "alreadyInList",
  SHARED_DICTIONARY_PERSONAL_CHANGED: "personalChanged",
  SHARED_DICTIONARY_PLAN_REQUIRED: "planRequired",
  SSO_REQUIRED: "ssoRequired",
  SHARED_DICTIONARY_NOT_MEMBER: "notMember",
  SHARED_DICTIONARY_LIST_FULL: "listFull",
};

function readConflicts(details: unknown): Array<{ id: string; word: string }> {
  const conflicts = (details as { conflicts?: unknown } | undefined)?.conflicts;
  if (!Array.isArray(conflicts)) return [];
  return conflicts.filter(
    (item): item is { id: string; word: string } =>
      typeof item?.id === "string" && typeof item?.word === "string"
  );
}

// Anything the API didn't answer with a known code (offline, 5xx, a local IPC
// failure) is "network": the UI offers a retry rather than a specific fix.
export function toSharedDictionaryActionError(error: unknown): SharedDictionaryActionError {
  if (error instanceof SharedDictionaryActionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CloudApiError && error.code && REASON_BY_CODE[error.code]) {
    return new SharedDictionaryActionError(
      REASON_BY_CODE[error.code],
      message,
      readConflicts(error.details)
    );
  }
  return new SharedDictionaryActionError("network", message);
}

// Trimmed, empty words dropped, deduped case-insensitively (first spelling wins).
function normalizeWords(words: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of words) {
    const word = raw.trim();
    const lower = word.toLowerCase();
    if (!word || seen.has(lower)) continue;
    seen.add(lower);
    result.push(word);
  }
  return result;
}

function chunk<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += MAX_SHARED_DICTIONARY_BATCH) {
    chunks.push(items.slice(index, index + MAX_SHARED_DICTIONARY_BATCH));
  }
  return chunks;
}

function requireApi(): NonNullable<Window["electronAPI"]> {
  const api = window.electronAPI;
  if (!api) throw new Error("Shared dictionary IPC unavailable");
  return api;
}

async function applyEntries(
  workspaceId: string,
  upserts: CloudSharedEntry[],
  deletedIds: string[] = []
): Promise<void> {
  if (upserts.length === 0 && deletedIds.length === 0) return;
  await requireApi().applySharedDictionaryPull?.(workspaceId, { upserts, deletedIds });
}

async function applyHides(workspaceId: string, hides: CloudSharedHide[]): Promise<void> {
  if (hides.length === 0) return;
  await requireApi().applySharedDictionaryHides?.(workspaceId, {
    hidden: hides
      .filter((hide) => !hide.deleted_at)
      .map((hide) => ({ entryId: hide.entry_id, updatedAt: hide.updated_at })),
    unhidden: hides.filter((hide) => hide.deleted_at).map((hide) => hide.entry_id),
  });
}

// The server already holds the write, so a failed local apply only delays it
// until the next pass; it never turns an accepted write into a failure.
async function applyAccepted(label: string, apply: () => Promise<void>): Promise<void> {
  try {
    await apply();
  } catch (error) {
    logger.warn(
      `Failed to apply an accepted shared dictionary ${label} locally`,
      { error: (error as Error)?.message },
      "dictionary"
    );
  }
}

// Mirrors the API: once the sharer hides a shared word or deletes it for
// everyone, their moved personal fallback goes too, unless another live copy
// they can see still carries the word. Reads the mirror after the local apply.
async function retireFallbacks(workspaceId: string, words: string[]): Promise<void> {
  if (words.length === 0) return;
  await applyAccepted("fallback retirement", async () => {
    const api = requireApi();
    if (!api.retireMovedDictionaryWords || !api.getSharedDictionary) return;
    const workspaces = new Set([workspaceId, useWorkspaceStore.getState().activeWorkspaceId]);
    const remaining = new Set<string>();
    for (const id of workspaces) {
      if (!id) continue;
      const snapshot = await api.getSharedDictionary(id);
      const hidden = new Set(snapshot.hiddenIds);
      for (const entry of snapshot.entries) {
        if (!hidden.has(entry.cloudId)) remaining.add(entry.word.toLowerCase());
      }
    }
    const candidates = words.filter((word) => !remaining.has(word.toLowerCase()));
    if (candidates.length === 0) return;
    const { retired } = await api.retireMovedDictionaryWords(candidates);
    if (retired.length === 0) return;
    const stored = await api.getDictionary?.();
    if (stored) useSettingsStore.getState().applyCustomDictionaryFromExternal(stored);
    void api.broadcastDictionaryUpdated?.();
    void syncService.syncDictionaryNow();
  });
}

// Words of the given entries in the local mirror, read before a delete removes them.
async function mirrorWords(workspaceId: string, entryIds: string[]): Promise<Map<string, string>> {
  const ids = new Set(entryIds);
  try {
    const snapshot = await requireApi().getSharedDictionary?.(workspaceId);
    return new Map(
      (snapshot?.entries ?? [])
        .filter((entry) => ids.has(entry.cloudId))
        .map((entry) => [entry.cloudId, entry.word])
    );
  } catch {
    return new Map();
  }
}

const wordsOf = (words: Map<string, string>, ids: string[]): string[] =>
  ids.flatMap((id) => (words.has(id) ? [words.get(id)!] : []));

// Reloads the page's snapshot (and the hints) from the mirror and lets a pass
// pick up whatever else changed, e.g. scopes after a notMember refusal.
async function refreshAfterWrite(): Promise<void> {
  await useSharedDictionaryStore.getState().reload();
  void syncService.syncSharedDictionaryNow();
}

export async function addSharedWords(
  workspaceId: string,
  target: ShareTarget,
  words: string[]
): Promise<{ added: string[]; alreadyPresent: string[]; failed: ActionFailure | null }> {
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  const chunks = chunk(normalizeWords(words));
  if (chunks.length === 0) return { added, alreadyPresent, failed: null };

  let failed: ActionFailure | null = null;
  for (const [index, batch] of chunks.entries()) {
    try {
      const response = await SharedDictionaryService.create(workspaceId, target, batch);
      await applyAccepted("add", () => applyEntries(workspaceId, response.created));
      added.push(...response.created.map((entry) => entry.word));
      alreadyPresent.push(...response.alreadyPresent);
    } catch (error) {
      failed = {
        words: chunks.slice(index).flat(),
        reason: toSharedDictionaryActionError(error).reason,
      };
      break;
    }
  }
  await refreshAfterWrite();
  return { added, alreadyPresent, failed };
}

export async function editSharedWord(
  workspaceId: string,
  entryId: string,
  word: string
): Promise<void> {
  try {
    const entry = await SharedDictionaryService.update(workspaceId, entryId, word.trim());
    await applyAccepted("edit", () => applyEntries(workspaceId, [entry]));
  } catch (error) {
    throw toSharedDictionaryActionError(error);
  } finally {
    await refreshAfterWrite();
  }
}

async function restoreSharedWords(workspaceId: string, entryIds: string[]): Promise<void> {
  try {
    for (const batch of chunk(entryIds)) {
      const response = await SharedDictionaryService.restore(workspaceId, batch);
      // A conflict is a word someone re-added meanwhile; the list already has it.
      await applyAccepted("restore", () => applyEntries(workspaceId, response.restored));
    }
  } catch (error) {
    throw toSharedDictionaryActionError(error);
  } finally {
    await refreshAfterWrite();
  }
}

// Deletes for everyone in the list. A failing chunk throws after the chunks
// before it were applied; the error then carries their count and an undo.
export async function deleteSharedWords(
  workspaceId: string,
  entryIds: string[]
): Promise<{ undo: () => Promise<void> }> {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return { undo: async () => {} };

  const words = await mirrorWords(workspaceId, ids);
  const deleted: string[] = [];
  let failure: SharedDictionaryActionError | null = null;
  try {
    for (const batch of chunk(ids)) {
      const response = await SharedDictionaryService.remove(workspaceId, batch);
      await applyAccepted("delete", () => applyEntries(workspaceId, [], response.deletedIds));
      deleted.push(...response.deletedIds);
    }
  } catch (error) {
    failure = toSharedDictionaryActionError(error);
  }
  await retireFallbacks(workspaceId, wordsOf(words, deleted));
  await refreshAfterWrite();

  // Only ids the server actually deleted come back; ones already gone stay gone.
  const undo = (): Promise<void> => restoreSharedWords(workspaceId, deleted);
  if (failure) {
    failure.appliedCount = deleted.length;
    if (deleted.length > 0) failure.undo = undo;
    throw failure;
  }
  return { undo };
}

export async function setSharedWordsHidden(
  workspaceId: string,
  entryIds: string[],
  hidden: boolean
): Promise<void> {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return;

  const words = hidden ? await mirrorWords(workspaceId, ids) : new Map<string, string>();
  const changed: string[] = [];
  let failure: SharedDictionaryActionError | null = null;
  try {
    for (const batch of chunk(ids)) {
      const response = await SharedDictionaryService.hide(workspaceId, batch, hidden);
      await applyAccepted("hide", () => applyHides(workspaceId, response.hides));
      changed.push(...response.hides.map((hide) => hide.entry_id));
    }
  } catch (error) {
    failure = toSharedDictionaryActionError(error);
  }
  if (hidden) await retireFallbacks(workspaceId, wordsOf(words, changed));
  await refreshAfterWrite();

  if (failure) {
    failure.appliedCount = changed.length;
    throw failure;
  }
}

// With cloud backup off the personal list never syncs, so a PERSONAL_CHANGED
// can't be resolved by pulling: the conflicting words go once more as plain
// words, carrying no personal id for the server to compare.
async function shareChunk(
  workspaceId: string,
  targets: ShareTarget[],
  personal: Array<{ id: string; word: string }>,
  plain: string[]
): Promise<SharedDictionaryShareResponse> {
  try {
    return await SharedDictionaryService.share(workspaceId, { targets, personal, words: plain });
  } catch (error) {
    const actionError = toSharedDictionaryActionError(error);
    if (actionError.reason !== "personalChanged" || syncService.canSync()) throw actionError;
    const conflictIds = new Set(actionError.conflicts.map((conflict) => conflict.id));
    const conflicting = (row: { id: string }): boolean =>
      conflictIds.size === 0 || conflictIds.has(row.id);
    try {
      return await SharedDictionaryService.share(workspaceId, {
        targets,
        personal: personal.filter((row) => !conflicting(row)),
        words: [...plain, ...personal.filter(conflicting).map((row) => row.word)],
      });
    } catch (retryError) {
      throw toSharedDictionaryActionError(retryError);
    }
  }
}

// Moves personal words into the chosen lists. The personal rows are only marked
// shared (never removed), and only for chunks the server accepted, so the user
// keeps every word whatever fails.
export async function sharePersonalWords(
  workspaceId: string,
  targets: ShareTarget[],
  words: string[]
): Promise<{
  moved: string[];
  alreadyPresent: Array<{ target: ShareTarget; word: string }>;
  failed: ActionFailure | null;
}> {
  const moved: string[] = [];
  const alreadyPresent: Array<{ target: ShareTarget; word: string }> = [];
  const chunks = chunk(normalizeWords(words));
  if (chunks.length === 0 || targets.length === 0) {
    return { moved, alreadyPresent, failed: null };
  }

  let failed: ActionFailure | null = null;
  for (const [index, batch] of chunks.entries()) {
    try {
      const api = requireApi();
      const stored = (await api.getDictionaryEntriesByWords?.(batch)) ?? [];
      const byLower = new Map(stored.map((row) => [row.word.toLowerCase(), row]));
      const personal: Array<{ id: string; word: string }> = [];
      const plain: string[] = [];
      for (const word of batch) {
        const row = byLower.get(word.toLowerCase());
        // The stored spelling is what the server compares against the cloud row.
        if (row?.cloudId) personal.push({ id: row.cloudId, word: row.word });
        else plain.push(row?.word ?? word);
      }

      const response = await shareChunk(workspaceId, targets, personal, plain);
      const sharedAt = new Date().toISOString();
      await applyAccepted("share mark", async () => {
        await api.markDictionaryWordsShared?.(batch, sharedAt);
      });
      await applyAccepted("share", () => applyEntries(workspaceId, response.created));
      moved.push(...batch);
      alreadyPresent.push(
        ...response.alreadyPresent.map((item) => ({ target: item.space_id, word: item.word }))
      );
    } catch (error) {
      const actionError = toSharedDictionaryActionError(error);
      failed = { words: chunks.slice(index).flat(), reason: actionError.reason };
      if (actionError.reason === "personalChanged") {
        logger.debug(
          "Sharing stopped: personal words changed on another device",
          { conflicts: actionError.conflicts.length },
          "dictionary"
        );
        // Pull the renamed or deleted words so the Personal list shows them.
        void syncService.syncDictionaryNow();
      }
      break;
    }
  }
  await refreshAfterWrite();
  return { moved, alreadyPresent, failed };
}
