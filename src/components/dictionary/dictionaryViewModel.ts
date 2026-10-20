import type { TFunction } from "i18next";
import type { ListKey } from "../../stores/sharedDictionaryStore";
import type { ShareTarget } from "../../services/sharedDictionaryActions";
import type { Workspace } from "../../types/electron";
import type {
  SharedDictionarySnapshot,
  SharedDictionarySnapshotEntry,
} from "../../types/sharedDictionary";
import { hasSharedDictionaryPlan } from "../../lib/workspaceBilling";
import { canManageWorkspace } from "../../lib/spacePermissions";

export type SortKey = "az" | "za" | "newest" | "oldest";

export const SORT_LABEL_KEYS: Record<SortKey, string> = {
  az: "dictionary.shared.sort.az",
  za: "dictionary.shared.sort.za",
  newest: "dictionary.shared.sort.newest",
  oldest: "dictionary.shared.sort.oldest",
};

export type SharedAccessState =
  "unavailable" | "noWorkspace" | "upgradeAdmin" | "upgradeMember" | "paused" | "available";

export interface PickerEntry {
  key: ListKey;
  label: string;
  // null while the shared lists haven't been read yet.
  count: number | null;
  locked: boolean;
  group: "top" | "shared" | "bottom";
}

export interface DictionaryRow {
  key: string;
  word: string;
  kind: "personal" | "shared";
  entryId: string | null;
  // The list a shared row belongs to, shown where a list mixes several.
  badge: string | null;
  attribution: "you" | "former" | { name: string } | null;
  createdAt: string | null;
}

type Snapshot = SharedDictionarySnapshot | null;

interface RowsInput {
  personal: string[];
  movedPersonal: string[];
  snapshot: Snapshot;
  workspaceName: string;
  currentUserId: string | null;
  access: SharedAccessState;
  search: string;
  sort: SortKey;
}

interface SharedRowOptions {
  badge: boolean;
  attribution: boolean;
}

const wordKey = (word: string): string => word.trim().toLowerCase();

export function resolveSharedAccessState(input: {
  capabilityAvailable: boolean;
  workspace: Workspace | null;
  // The server's flag: a downgraded workspace that still holds shared words.
  serverPaused: boolean | null;
}): SharedAccessState {
  const { capabilityAvailable, workspace, serverPaused } = input;
  if (!capabilityAvailable) return "unavailable";
  if (!workspace) return "noWorkspace";
  if (serverPaused === true) return "paused";
  if (!hasSharedDictionaryPlan(workspace)) {
    return canManageWorkspace(workspace.role) ? "upgradeAdmin" : "upgradeMember";
  }
  return "available";
}

// Entries of lists the member can still read. The snapshot is replaced when the
// readable lists change, so the filter only guards the window before that.
function readableEntries(snapshot: Snapshot): SharedDictionarySnapshotEntry[] {
  if (!snapshot) return [];
  const scopes = snapshot.meta?.scopes;
  if (!scopes) return snapshot.entries;
  const readable = new Set(scopes.map((scope) => scope.space_id));
  return snapshot.entries.filter((entry) => readable.has(entry.spaceId));
}

function visibleSharedEntries(snapshot: Snapshot): SharedDictionarySnapshotEntry[] {
  if (!snapshot) return [];
  const hidden = new Set(snapshot.hiddenIds);
  return readableEntries(snapshot).filter((entry) => !hidden.has(entry.cloudId));
}

function hiddenSharedEntries(snapshot: Snapshot): SharedDictionarySnapshotEntry[] {
  if (!snapshot) return [];
  const hidden = new Set(snapshot.hiddenIds);
  return readableEntries(snapshot).filter((entry) => hidden.has(entry.cloudId));
}

/**
 * Personal words minus those moved into a team list while that shared copy
 * still exists. The personal row is kept underneath as a fallback, so if the
 * copy is deleted the word returns to Personal. A hidden copy still counts:
 * the server retires the fallback when a member hides the shared word.
 */
export function visiblePersonalWords(
  personal: string[],
  movedPersonal: string[],
  snapshot: Snapshot
): string[] {
  if (movedPersonal.length === 0 || !snapshot) return personal;
  const moved = new Set(movedPersonal.map(wordKey));
  const sharedWords = new Set(readableEntries(snapshot).map((entry) => wordKey(entry.word)));
  return personal.filter((word) => {
    const key = wordKey(word);
    return !(moved.has(key) && sharedWords.has(key));
  });
}

function scopeName(snapshot: Snapshot, spaceId: string | null, workspaceName: string): string {
  if (spaceId === null) return workspaceName;
  const scope = snapshot?.meta?.scopes.find((candidate) => candidate.space_id === spaceId);
  return scope?.name ?? workspaceName;
}

function attributionFor(
  entry: SharedDictionarySnapshotEntry,
  snapshot: Snapshot,
  currentUserId: string | null
): DictionaryRow["attribution"] {
  if (entry.addedByUserId === null) return "former";
  if (currentUserId !== null && entry.addedByUserId === currentUserId) return "you";
  const contributor = snapshot?.meta?.contributors.find(
    (candidate) => candidate.user_id === entry.addedByUserId
  );
  // With no name to show (unknown or nameless contributor) the row reads as a former member.
  if (!contributor || !contributor.is_member || !contributor.name) return "former";
  return { name: contributor.name };
}

function sharedRow(
  entry: SharedDictionarySnapshotEntry,
  input: RowsInput,
  options: SharedRowOptions
): DictionaryRow {
  return {
    key: `shared:${entry.cloudId}`,
    word: entry.word,
    kind: "shared",
    entryId: entry.cloudId,
    badge: options.badge ? scopeName(input.snapshot, entry.spaceId, input.workspaceName) : null,
    attribution: options.attribution
      ? attributionFor(entry, input.snapshot, input.currentUserId)
      : null,
    createdAt: entry.createdAt,
  };
}

function personalRow(word: string): DictionaryRow {
  return {
    key: `personal:${wordKey(word)}`,
    word,
    kind: "personal",
    entryId: null,
    badge: null,
    attribution: null,
    createdAt: null,
  };
}

// Space words rank above workspace words, as they do in dictation hints.
function spaceEntriesFirst(
  entries: SharedDictionarySnapshotEntry[]
): SharedDictionarySnapshotEntry[] {
  return [
    ...entries.filter((entry) => entry.spaceId !== null),
    ...entries.filter((entry) => entry.spaceId === null),
  ];
}

// Each word once, in the priority dictation uses: personal, then space, then workspace.
// While shared words don't apply (locked or paused), moved personal words keep
// applying at personal priority, so Personal and All words show them again.
function personalWordsShown(input: RowsInput): string[] {
  if (input.access !== "available") return input.personal;
  return visiblePersonalWords(input.personal, input.movedPersonal, input.snapshot);
}

function allWordsRows(input: RowsInput): DictionaryRow[] {
  const seen = new Set<string>();
  const rows: DictionaryRow[] = [];
  for (const word of personalWordsShown(input)) {
    const key = wordKey(word);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(personalRow(word));
  }
  // Shared words only join All words while they apply.
  if (input.access !== "available") return rows;
  for (const entry of spaceEntriesFirst(visibleSharedEntries(input.snapshot))) {
    const key = wordKey(entry.word);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(sharedRow(entry, input, { badge: true, attribution: false }));
  }
  return rows;
}

function unsortedRows(list: ListKey, input: RowsInput): DictionaryRow[] {
  const { snapshot } = input;
  const inSingleList = (spaceId: string | null): DictionaryRow[] =>
    visibleSharedEntries(snapshot)
      .filter((entry) => entry.spaceId === spaceId)
      .map((entry) => sharedRow(entry, input, { badge: false, attribution: true }));

  switch (list) {
    case "all":
      return allWordsRows(input);
    case "personal":
      return personalWordsShown(input).map(personalRow);
    case "allShared":
      // One row per list entry: the same word in two lists is two rows.
      return visibleSharedEntries(snapshot).map((entry) =>
        sharedRow(entry, input, { badge: true, attribution: false })
      );
    case "hidden":
      return hiddenSharedEntries(snapshot).map((entry) =>
        sharedRow(entry, input, { badge: true, attribution: true })
      );
    case "workspace":
      return inSingleList(null);
    default:
      return inSingleList(list.slice("space:".length));
  }
}

function timestamp(row: DictionaryRow): number | null {
  if (!row.createdAt) return null;
  const parsed = Date.parse(row.createdAt);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareRows(sort: SortKey): (left: DictionaryRow, right: DictionaryRow) => number {
  const byWord = (left: DictionaryRow, right: DictionaryRow): number =>
    left.word.localeCompare(right.word, undefined, { sensitivity: "base" });
  if (sort === "az") return byWord;
  if (sort === "za") return (left, right) => byWord(right, left);
  const direction = sort === "newest" ? -1 : 1;
  return (left, right) => {
    const leftTime = timestamp(left);
    const rightTime = timestamp(right);
    // Rows without a date (personal words) sort last either way.
    if (leftTime === null && rightTime === null) return byWord(left, right);
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return leftTime === rightTime ? byWord(left, right) : direction * (leftTime - rightTime);
  };
}

export function rowsForList(list: ListKey, input: RowsInput): DictionaryRow[] {
  const needle = input.search.trim().toLowerCase();
  const rows = unsortedRows(list, input);
  const matching = needle ? rows.filter((row) => row.word.toLowerCase().includes(needle)) : rows;
  return [...matching].sort(compareRows(input.sort));
}

export function buildPicker(input: {
  personal: string[];
  movedPersonal: string[];
  snapshot: Snapshot;
  workspaceName: string;
  access: SharedAccessState;
  t: TFunction;
}): PickerEntry[] {
  const { personal, movedPersonal, snapshot, workspaceName, access, t } = input;
  const locked = access !== "available";
  const visible = visibleSharedEntries(snapshot);
  const countIn = (spaceId: string | null): number | null =>
    snapshot ? visible.filter((entry) => entry.spaceId === spaceId).length : null;

  const rowsInput: RowsInput = {
    personal,
    movedPersonal,
    snapshot,
    workspaceName,
    currentUserId: null,
    access,
    search: "",
    sort: "az",
  };

  const entries: PickerEntry[] = [
    {
      key: "all",
      label: t("dictionary.shared.allWords"),
      count: allWordsRows(rowsInput).length,
      locked: false,
      group: "top",
    },
    {
      key: "personal",
      label: t("dictionary.shared.personal"),
      count: personalWordsShown(rowsInput).length,
      locked: false,
      group: "top",
    },
    {
      key: "allShared",
      label: t("dictionary.shared.allShared"),
      count: snapshot ? visible.length : null,
      locked,
      group: "shared",
    },
    {
      key: "workspace",
      label: t("dictionary.shared.everyoneAt", { workspace: workspaceName }),
      count: countIn(null),
      locked,
      group: "shared",
    },
  ];

  // Spaces come from the scopes the member can read, so an owner outside a space has no entry for it.
  for (const scope of snapshot?.meta?.scopes ?? []) {
    if (scope.space_id === null) continue;
    entries.push({
      key: `space:${scope.space_id}`,
      label: scope.name,
      count: countIn(scope.space_id),
      locked,
      group: "shared",
    });
  }

  entries.push({
    key: "hidden",
    label: t("dictionary.shared.hidden"),
    count: snapshot ? hiddenSharedEntries(snapshot).length : null,
    locked,
    group: "bottom",
  });
  return entries;
}

export function defaultAddTarget(
  list: ListKey,
  // undefined is "nothing remembered"; null is the workspace list.
  lastUsed: ShareTarget | "personal" | undefined
): ShareTarget | "personal" {
  if (list === "personal") return "personal";
  if (list === "workspace") return null;
  if (list.startsWith("space:")) return list.slice("space:".length);
  return lastUsed === undefined ? "personal" : lastUsed;
}

export function shareTargetsFor(
  words: string[],
  snapshot: SharedDictionarySnapshot,
  workspaceName: string,
  t: TFunction
): Array<{ target: ShareTarget; label: string; memberCount: number; alreadyShared: boolean }> {
  const wanted = words.map(wordKey).filter(Boolean);
  const entries = readableEntries(snapshot);
  const scopes = snapshot.meta?.scopes ?? [];
  // Workspace first, then spaces in the order the server listed them.
  const ordered = [
    ...scopes.filter((scope) => scope.space_id === null),
    ...scopes.filter((scope) => scope.space_id !== null),
  ];
  return ordered.map((scope) => {
    const inList = new Set(
      entries
        .filter((entry) => entry.spaceId === scope.space_id)
        .map((entry) => wordKey(entry.word))
    );
    return {
      target: scope.space_id,
      label:
        scope.space_id === null
          ? t("dictionary.shared.everyoneAt", { workspace: workspaceName })
          : scope.name,
      memberCount: scope.member_count,
      alreadyShared: wanted.length > 0 && wanted.every((word) => inList.has(word)),
    };
  });
}
