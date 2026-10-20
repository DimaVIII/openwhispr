import { CloudApiError } from "./cloudApi";
import { MAX_SHARED_DICTIONARY_BATCH, SharedDictionaryService } from "./SharedDictionaryService";
import { syncService } from "./SyncService";
import { useSharedDictionaryStore } from "../stores/sharedDictionaryStore";
import type { CloudSharedEntry, CloudSharedHide } from "../types/sharedDictionary";
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
// before it were applied; those stay deleted and get no undo.
export async function deleteSharedWords(
  workspaceId: string,
  entryIds: string[]
): Promise<{ undo: () => Promise<void> }> {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return { undo: async () => {} };

  const deleted: string[] = [];
  try {
    for (const batch of chunk(ids)) {
      const response = await SharedDictionaryService.remove(workspaceId, batch);
      await applyAccepted("delete", () => applyEntries(workspaceId, [], response.deletedIds));
      deleted.push(...response.deletedIds);
    }
  } catch (error) {
    throw toSharedDictionaryActionError(error);
  } finally {
    await refreshAfterWrite();
  }
  // Only ids the server actually deleted come back; ones already gone stay gone.
  return { undo: () => restoreSharedWords(workspaceId, deleted) };
}

export async function setSharedWordsHidden(
  workspaceId: string,
  entryIds: string[],
  hidden: boolean
): Promise<void> {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return;
  try {
    for (const batch of chunk(ids)) {
      const response = await SharedDictionaryService.hide(workspaceId, batch, hidden);
      await applyAccepted("hide", () => applyHides(workspaceId, response.hides));
    }
  } catch (error) {
    throw toSharedDictionaryActionError(error);
  } finally {
    await refreshAfterWrite();
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

      const response = await SharedDictionaryService.share(workspaceId, {
        targets,
        personal,
        words: plain,
      });
      const sharedAt = new Date().toISOString();
      await applyAccepted("share", async () => {
        await api.markDictionaryWordsShared?.(batch, sharedAt);
        await applyEntries(workspaceId, response.created);
      });
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
