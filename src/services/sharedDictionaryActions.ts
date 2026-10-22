import { CloudApiError } from "./cloudApi";
import {
  MAX_SHARED_DICTIONARY_BATCH,
  MAX_SHARED_DICTIONARY_TARGETS,
  SharedDictionaryService,
} from "./SharedDictionaryService";
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
  // The API refused the request as malformed (a word it won't store, too many
  // lists), or the client did before sending it.
  | "invalid"
  // A rename onto a word deleted from that list moments ago (restore it instead).
  | "recentlyDeleted"
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
  // The list that refused them, when that's known: a share to one list that
  // came back listFull. LIST_FULL names no list, so a share to several leaves it out.
  target?: ShareTarget;
}

const REASON_BY_CODE: Record<string, SharedDictionaryActionReason> = {
  SHARED_DICTIONARY_ALREADY_IN_LIST: "alreadyInList",
  SHARED_DICTIONARY_PERSONAL_CHANGED: "personalChanged",
  SHARED_DICTIONARY_PLAN_REQUIRED: "planRequired",
  SSO_REQUIRED: "ssoRequired",
  SHARED_DICTIONARY_NOT_MEMBER: "notMember",
  SHARED_DICTIONARY_LIST_FULL: "listFull",
  SHARED_DICTIONARY_INVALID_REQUEST: "invalid",
  SHARED_DICTIONARY_RECENTLY_DELETED: "recentlyDeleted",
};

function readConflicts(details: unknown): Array<{ id: string; word: string }> {
  const conflicts = (details as { conflicts?: unknown } | undefined)?.conflicts;
  if (!Array.isArray(conflicts)) return [];
  return conflicts.filter(
    (item): item is { id: string; word: string } =>
      typeof item?.id === "string" && typeof item?.word === "string"
  );
}

// A 400 without a code (older API, query validation) is still a malformed
// request: retrying it would fail the same way. Anything else the API didn't
// answer with a known code (offline, 5xx, a local IPC failure) is "network":
// the UI offers a retry rather than a specific fix.
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
  if (error instanceof CloudApiError && error.status === 400) {
    return new SharedDictionaryActionError("invalid", message);
  }
  return new SharedDictionaryActionError("network", message);
}

// The API's rule for a shared word (sharedWordError in openwhispr-api's
// schemas.ts): NFC, trimmed, 1-100 characters, no control characters, line
// breaks or invisible format characters (ZWNJ and ZWJ allowed).
const MAX_SHARED_WORD_LENGTH = 100;
const FORBIDDEN_SHARED_WORD = /[\p{Cc}\u2028\u2029]|(?![\u200C\u200D])\p{Cf}/u;

// The spelling the API stores, or null when it would refuse the word.
function toSharedWord(raw: string): string | null {
  const word = raw.normalize("NFC").trim();
  if (!word || word.length > MAX_SHARED_WORD_LENGTH || FORBIDDEN_SHARED_WORD.test(word)) {
    return null;
  }
  return word;
}

// A word the client types or adds: a whitespace run (a pasted tab) becomes
// one space first, which the API would otherwise refuse.
const toTypedSharedWord = (raw: string): string | null => toSharedWord(raw.replace(/\s+/g, " "));

// Empty words dropped, deduped case-insensitively (first spelling wins).
function dedupeWords(words: string[]): string[] {
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

// Words that can't be sent are reported beside any failure, so the result
// counts every word that wasn't moved: the stopping failure's words first.
function failureOrRejected(failed: ActionFailure | null, rejected: string[]): ActionFailure | null {
  if (rejected.length === 0) return failed;
  if (!failed) return { words: rejected, reason: "invalid" };
  const listed = new Set(failed.words);
  return { ...failed, words: [...failed.words, ...rejected.filter((word) => !listed.has(word))] };
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

// Each returns the mirror rows it changed.
async function applyEntries(
  workspaceId: string,
  upserts: CloudSharedEntry[],
  deletedIds: string[] = []
): Promise<number> {
  if (upserts.length === 0 && deletedIds.length === 0) return 0;
  const result = await requireApi().applySharedDictionaryPull?.(workspaceId, {
    upserts,
    deletedIds,
  });
  return result?.changed ?? 0;
}

async function applyHides(workspaceId: string, hides: CloudSharedHide[]): Promise<number> {
  if (hides.length === 0) return 0;
  const result = await requireApi().applySharedDictionaryHides?.(workspaceId, {
    hidden: hides
      .filter((hide) => !hide.deleted_at)
      .map((hide) => ({ entryId: hide.entry_id, updatedAt: hide.updated_at })),
    unhidden: hides.filter((hide) => hide.deleted_at).map((hide) => hide.entry_id),
  });
  return result?.changed ?? 0;
}

// The server already holds the write, so a failed local apply only delays it
// until the next pass; it never turns an accepted write into a failure.
async function applyAccepted(label: string, apply: () => Promise<number | void>): Promise<number> {
  try {
    const changed = await apply();
    return typeof changed === "number" ? changed : 0;
  } catch (error) {
    logger.warn(
      `Failed to apply an accepted shared dictionary ${label} locally`,
      { error: (error as Error)?.message },
      "dictionary"
    );
    return 0;
  }
}

// After a write that can retire or revive the sharer's moved fallback: shows
// a local change at once, and pulls the personal list either way, since the
// server decides (it checks every workspace and follows renames).
async function reconcilePersonal(changedLocally: boolean): Promise<void> {
  if (changedLocally) {
    const api = requireApi();
    const stored = await api.getDictionary?.();
    if (stored) useSettingsStore.getState().applyCustomDictionaryFromExternal(stored);
    void api.broadcastDictionaryUpdated?.();
  }
  void syncService.syncDictionaryNow();
}

// Mirrors the API: once the sharer hides a shared word or deletes it for
// everyone, their moved personal fallback goes too, unless another live copy
// they can see still carries the word. Reads the mirror after the local apply.
async function retireFallbacks(workspaceId: string, words: string[]): Promise<void> {
  if (words.length === 0) return;
  await applyAccepted("fallback retirement", async () => {
    const api = requireApi();
    if (!api.retireMovedDictionaryWords || !api.getSharedDictionary) return;
    const workspaces = new Set([
      workspaceId,
      ...useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id),
    ]);
    const remaining = new Set<string>();
    for (const id of workspaces) {
      const snapshot = await api.getSharedDictionary(id);
      const hidden = new Set(snapshot.hiddenIds);
      for (const entry of snapshot.entries) {
        if (!hidden.has(entry.cloudId)) remaining.add(entry.word.toLowerCase());
      }
    }
    const candidates = words.filter((word) => !remaining.has(word.toLowerCase()));
    // With sync on, the server retires (or keeps) a synced fallback in the same
    // request and the pull below brings its answer; only words it can't know
    // about are retired here.
    const { retired } =
      candidates.length > 0
        ? await api.retireMovedDictionaryWords(candidates, {
            includeSynced: !syncService.canSync(),
          })
        : { retired: [] };
    await reconcilePersonal(retired.length > 0);
  });
}

// The other half: a restore or un-hide brings back the fallbacks the delete or
// hide retired here, as the API does.
async function reviveFallbacks(words: string[]): Promise<void> {
  if (words.length === 0) return;
  await applyAccepted("fallback revival", async () => {
    const api = requireApi();
    const { revived } = (await api.reviveRetiredDictionaryWords?.(words)) ?? { revived: [] };
    await reconcilePersonal(revived.length > 0);
  });
}

// Words of the given entries in the local mirror, and which of them the member
// hid, read before a delete removes both.
async function mirrorWords(
  workspaceId: string,
  entryIds: string[]
): Promise<{ words: Map<string, string>; hidden: Set<string> }> {
  const ids = new Set(entryIds);
  try {
    const snapshot = await requireApi().getSharedDictionary?.(workspaceId);
    return {
      words: new Map(
        (snapshot?.entries ?? [])
          .filter((entry) => ids.has(entry.cloudId))
          .map((entry) => [entry.cloudId, entry.word])
      ),
      hidden: new Set((snapshot?.hiddenIds ?? []).filter((id) => ids.has(id))),
    };
  } catch {
    return { words: new Map(), hidden: new Set() };
  }
}

const wordsOf = (words: Map<string, string>, ids: string[]): string[] =>
  ids.flatMap((id) => (words.has(id) ? [words.get(id)!] : []));

// Reloads the page's snapshot (and the hints) from the mirror, tells the other
// windows' Dictionary pages when the mirror changed, and lets a pass pick up
// whatever else changed, e.g. scopes after a notMember refusal.
async function refreshAfterWrite(workspaceId: string, mirrorChanged: number): Promise<void> {
  await useSharedDictionaryStore.getState().reload();
  if (mirrorChanged > 0) {
    void window.electronAPI
      ?.emitSyncEvent?.("shared-dictionary-changed", { workspaceId })
      ?.catch((error: unknown) =>
        logger.warn(
          "Failed to announce a shared dictionary change",
          { error: (error as Error)?.message },
          "dictionary"
        )
      );
  }
  void syncService.syncSharedDictionaryNow();
}

// `rejected` are words the API would refuse (too long, control characters);
// they are never sent, and `failed` reports them as "invalid" when nothing else
// failed.
export async function addSharedWords(
  workspaceId: string,
  target: ShareTarget,
  words: string[]
): Promise<{
  added: string[];
  alreadyPresent: string[];
  rejected: string[];
  failed: ActionFailure | null;
}> {
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  const rejected: string[] = [];
  const sendable: string[] = [];
  for (const word of dedupeWords(words)) {
    const shared = toTypedSharedWord(word);
    if (shared) sendable.push(shared);
    else rejected.push(word);
  }
  const chunks = chunk(dedupeWords(sendable));
  if (chunks.length === 0) {
    return { added, alreadyPresent, rejected, failed: failureOrRejected(null, rejected) };
  }

  let failed: ActionFailure | null = null;
  let mirrorChanged = 0;
  for (const [index, batch] of chunks.entries()) {
    try {
      const response = await SharedDictionaryService.create(workspaceId, target, batch);
      mirrorChanged += await applyAccepted("add", () =>
        applyEntries(workspaceId, response.created)
      );
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
  await refreshAfterWrite(workspaceId, mirrorChanged);
  return { added, alreadyPresent, rejected, failed: failureOrRejected(failed, rejected) };
}

export async function editSharedWord(
  workspaceId: string,
  entryId: string,
  word: string
): Promise<void> {
  const sendable = toTypedSharedWord(word);
  if (!sendable) {
    throw new SharedDictionaryActionError("invalid", "The API would refuse this word");
  }
  let mirrorChanged = 0;
  try {
    const entry = await SharedDictionaryService.update(workspaceId, entryId, sendable);
    mirrorChanged = await applyAccepted("edit", () => applyEntries(workspaceId, [entry]));
  } catch (error) {
    throw toSharedDictionaryActionError(error);
  } finally {
    await refreshAfterWrite(workspaceId, mirrorChanged);
  }
}

// `hiddenIds`: entries the member had hidden before the delete. The API revives
// their hides with them, so those words don't reach the member again and their
// fallback stays retired.
async function restoreSharedWords(
  workspaceId: string,
  entryIds: string[],
  hiddenIds: Set<string>
): Promise<void> {
  let mirrorChanged = 0;
  const restoredWords: string[] = [];
  try {
    for (const batch of chunk(entryIds)) {
      const response = await SharedDictionaryService.restore(workspaceId, batch);
      // A conflict is a word someone re-added meanwhile; the list already has it.
      mirrorChanged += await applyAccepted("restore", () =>
        applyEntries(workspaceId, response.restored)
      );
      restoredWords.push(
        ...response.restored.filter((entry) => !hiddenIds.has(entry.id)).map((entry) => entry.word)
      );
    }
  } catch (error) {
    throw toSharedDictionaryActionError(error);
  } finally {
    await reviveFallbacks(restoredWords);
    await refreshAfterWrite(workspaceId, mirrorChanged);
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

  const { words, hidden } = await mirrorWords(workspaceId, ids);
  const deleted: string[] = [];
  let failure: SharedDictionaryActionError | null = null;
  let mirrorChanged = 0;
  try {
    for (const batch of chunk(ids)) {
      const response = await SharedDictionaryService.remove(workspaceId, batch);
      mirrorChanged += await applyAccepted("delete", () =>
        applyEntries(workspaceId, [], response.deletedIds)
      );
      deleted.push(...response.deletedIds);
    }
  } catch (error) {
    failure = toSharedDictionaryActionError(error);
  }
  await retireFallbacks(workspaceId, wordsOf(words, deleted));
  await refreshAfterWrite(workspaceId, mirrorChanged);

  // Only ids the server actually deleted come back; ones already gone stay gone.
  const undo = (): Promise<void> => restoreSharedWords(workspaceId, deleted, hidden);
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

  const { words } = await mirrorWords(workspaceId, ids);
  const changed: string[] = [];
  let failure: SharedDictionaryActionError | null = null;
  let mirrorChanged = 0;
  try {
    for (const batch of chunk(ids)) {
      const response = await SharedDictionaryService.hide(workspaceId, batch, hidden);
      mirrorChanged += await applyAccepted("hide", () => applyHides(workspaceId, response.hides));
      changed.push(...response.hides.map((hide) => hide.entry_id));
    }
  } catch (error) {
    failure = toSharedDictionaryActionError(error);
  }
  if (hidden) await retireFallbacks(workspaceId, wordsOf(words, changed));
  else await reviveFallbacks(wordsOf(words, changed));
  await refreshAfterWrite(workspaceId, mirrorChanged);

  if (failure) {
    failure.appliedCount = changed.length;
    throw failure;
  }
}

// Words the list refused (format rules beyond the client's own checks). An API
// from before this field sends none.
function readShareRejections(
  response: SharedDictionaryShareResponse
): Array<{ id: string | null; word: string }> {
  const { rejected } = response;
  if (!Array.isArray(rejected)) return [];
  return rejected.filter(
    (item) => typeof item?.word === "string" && (item.id === null || typeof item.id === "string")
  );
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
  rejected: string[];
  failed: ActionFailure | null;
}> {
  const moved: string[] = [];
  const alreadyPresent: Array<{ target: ShareTarget; word: string }> = [];
  const candidates = dedupeWords(words);
  const rejected: string[] = [];
  const uniqueTargets = [...new Set(targets)];
  const chunks = chunk(candidates);
  if (chunks.length === 0 || uniqueTargets.length === 0) {
    return { moved, alreadyPresent, rejected, failed: failureOrRejected(null, rejected) };
  }
  // The API refuses more lists than this in one request; nothing is sent.
  if (uniqueTargets.length > MAX_SHARED_DICTIONARY_TARGETS) {
    return {
      moved,
      alreadyPresent,
      rejected,
      failed: { words: candidates, reason: "invalid" },
    };
  }

  let failed: ActionFailure | null = null;
  let mirrorChanged = 0;
  for (const [index, batch] of chunks.entries()) {
    try {
      const api = requireApi();
      const stored = (await api.getDictionaryEntriesByWords?.(batch)) ?? [];
      const byLower = new Map(stored.map((row) => [row.word.toLowerCase(), row]));
      const personal: Array<{ id: string; word: string }> = [];
      const plain: string[] = [];
      const sent: string[] = [];
      // The caller's word for each personal id and each word as sent, so the
      // server's refusals map back to it.
      const sentById = new Map<string, string>();
      const sentByLower = new Map<string, string>();
      for (const word of batch) {
        const row = byLower.get(word.toLowerCase());
        if (row?.cloudId) {
          // Sent as stored, since the server compares it with the cloud row; it
          // refuses an unshareable one per word (`rejected`), but a word over
          // the length cap fails the whole request.
          if (row.word.trim().length > MAX_SHARED_WORD_LENGTH) {
            rejected.push(word);
            continue;
          }
          personal.push({ id: row.cloudId, word: row.word });
          sentById.set(row.cloudId, word);
          sentByLower.set(row.word.trim().toLowerCase(), word);
        } else {
          // Plain words are validated as a whole: one bad word fails the request.
          const sendable = toTypedSharedWord(row?.word ?? word);
          if (!sendable) {
            rejected.push(word);
            continue;
          }
          plain.push(sendable);
          sentByLower.set(sendable.toLowerCase(), word);
        }
        sent.push(word);
      }
      if (sent.length === 0) continue;

      const response = await shareChunk(workspaceId, uniqueTargets, personal, plain);
      // Words the list refused aren't moved: no shared_at for them.
      const refusedHere = new Set(
        readShareRejections(response).flatMap((item) => {
          const word =
            (item.id ? sentById.get(item.id) : undefined) ??
            sentByLower.get(item.word.normalize("NFC").trim().toLowerCase()) ??
            sentByLower.get(item.word.trim().toLowerCase());
          return word ? [word] : [];
        })
      );
      rejected.push(...refusedHere);
      const accepted = sent.filter((word) => !refusedHere.has(word));
      const sharedAt = new Date().toISOString();
      if (accepted.length > 0) {
        await applyAccepted("share mark", async () => {
          await api.markDictionaryWordsShared?.(accepted, sharedAt);
        });
      }
      mirrorChanged += await applyAccepted("share", () =>
        applyEntries(workspaceId, response.created)
      );
      moved.push(...accepted);
      alreadyPresent.push(
        ...response.alreadyPresent.map((item) => ({ target: item.space_id, word: item.word }))
      );
    } catch (error) {
      const actionError = toSharedDictionaryActionError(error);
      const refused = new Set(rejected);
      failed = {
        words: chunks
          .slice(index)
          .flat()
          .filter((word) => !refused.has(word)),
        reason: actionError.reason,
      };
      if (actionError.reason === "listFull" && uniqueTargets.length === 1) {
        failed.target = uniqueTargets[0];
      }
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
  await refreshAfterWrite(workspaceId, mirrorChanged);
  return { moved, alreadyPresent, rejected, failed: failureOrRejected(failed, rejected) };
}
