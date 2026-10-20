import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../ui/useToast";
import {
  SharedDictionaryActionError,
  addSharedWords,
  deleteSharedWords,
  editSharedWord,
  setSharedWordsHidden,
  sharePersonalWords,
  type ShareTarget,
  type SharedDictionaryActionReason,
} from "../../services/sharedDictionaryActions";
import { syncService } from "../../services/SyncService";
import { useSharedDictionaryStore } from "../../stores/sharedDictionaryStore";
import { parseDictionaryImportText } from "../../helpers/dictionaryImport";
import type { SharedDictionarySnapshot } from "../../types/sharedDictionary";
import type { AddTarget } from "./DictionaryAddField";
import { visiblePersonalWords, type DictionaryRow } from "./dictionaryViewModel";

interface DictionaryActionsInput {
  workspaceId: string | null;
  workspaceName: string;
  customDictionary: string[];
  // The personal words minus the agent name, as the Personal list shows them.
  userWords: string[];
  agentName: string;
  updateCustomDictionary: (changes: { add?: string[]; remove?: string[] }) => void;
  movedPersonal: string[];
  snapshot: SharedDictionarySnapshot | null;
  listLabel: (target: AddTarget) => string;
}

interface PendingSharedDelete {
  entryIds: string[];
  words: string[];
  listName: string;
  onDeleted?: () => void;
}

export interface DictionaryActions {
  // Personal words the member can see; clear-all removes exactly these.
  visiblePersonal: string[];
  wordsInTarget: (target: AddTarget) => string[];
  // Resolves true once nothing is left to add, which clears the field.
  addWords: (text: string, target: AddTarget) => Promise<boolean>;
  // Resolves an error to show in the open editor, or null to close it.
  editRow: (row: DictionaryRow, word: string) => Promise<string | null>;
  // Resolves true once every row changed.
  setRowsHidden: (rows: DictionaryRow[], hidden: boolean) => Promise<boolean>;
  // Delete for everyone always asks first; the dialog reads `deleteTitle`.
  // onDeleted runs once the confirmed delete fully succeeded.
  requestDeleteForEveryone: (rows: DictionaryRow[], onDeleted?: () => void) => void;
  // Moves personal words into the lists; resolves true when all of them went.
  shareWords: (words: string[], targets: ShareTarget[]) => Promise<boolean>;
  deleteTitle: string | null;
  confirmDelete: () => void;
  cancelDelete: () => void;
  syncing: boolean;
  sync: () => Promise<void>;
  exportPersonal: () => Promise<void>;
  clearPersonal: () => void;
}

const sameWord = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();
const reasonOf = (error: unknown): SharedDictionaryActionReason =>
  error instanceof SharedDictionaryActionError ? error.reason : "network";

export function useDictionaryActions({
  workspaceId,
  workspaceName,
  customDictionary,
  userWords,
  agentName,
  updateCustomDictionary,
  movedPersonal,
  snapshot,
  listLabel,
}: DictionaryActionsInput): DictionaryActions {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingSharedDelete | null>(null);

  // Ruling 4: clear-all and export leave out words moved into a team list,
  // which stay under the shared copy as the member's fallback.
  const visiblePersonal = useMemo(
    () => visiblePersonalWords(userWords, movedPersonal, snapshot),
    [userWords, movedPersonal, snapshot]
  );

  // Re-adding a moved word makes it personal again in SQLite; the stored list
  // arrives after that write, so reread which words are still moved.
  const seenDictionary = useRef(customDictionary);
  useEffect(() => {
    if (seenDictionary.current === customDictionary) return;
    seenDictionary.current = customDictionary;
    const store = useSharedDictionaryStore.getState();
    if (store.movedPersonal.length > 0) void store.reload();
  }, [customDictionary]);

  const errorTitle = useCallback(
    (reason: SharedDictionaryActionReason, listName: string): string =>
      reason === "listFull"
        ? t("dictionary.shared.errors.listFull", { list: listName })
        : t("dictionary.shared.errors.generic", { list: listName }),
    [t]
  );

  const showActionError = useCallback(
    (reason: SharedDictionaryActionReason, listName: string): void => {
      toast({ title: errorTitle(reason, listName), variant: "destructive" });
    },
    [toast, errorTitle]
  );

  const wordsInTarget = (target: AddTarget): string[] => {
    // A moved word the member can't see in Personal can be added back to it.
    if (target === "personal") return [...visiblePersonal, agentName];
    // A hidden word still belongs to its list, so the server would refuse it too.
    return (snapshot?.entries ?? [])
      .filter((entry) => entry.spaceId === target)
      .map((entry) => entry.word);
  };

  const sharedListName = (row: DictionaryRow): string => {
    const spaceId = snapshot?.entries.find((entry) => entry.cloudId === row.entryId)?.spaceId;
    return spaceId === undefined ? workspaceName : listLabel(spaceId);
  };

  const addWords = async (text: string, target: AddTarget): Promise<boolean> => {
    const existing = new Set(wordsInTarget(target).map((word) => word.toLowerCase()));
    const words = parseDictionaryImportText(text).filter((word) => {
      if (existing.has(word.toLowerCase())) return false;
      existing.add(word.toLowerCase());
      return true;
    });
    if (words.length === 0) return true;
    if (target === "personal") {
      updateCustomDictionary({ add: words });
      return true;
    }
    if (!workspaceId) return false;
    const result = await addSharedWords(workspaceId, target, words);
    if (result.failed) {
      showActionError(result.failed.reason, listLabel(target));
      return false;
    }
    return true;
  };

  const editRow = async (row: DictionaryRow, word: string): Promise<string | null> => {
    if (word === row.word) return null;
    if (row.kind === "personal") {
      if (customDictionary.some((other) => other !== row.word && sameWord(other, word))) {
        return t("dictionary.shared.alreadyIn", { list: t("dictionary.shared.personal") });
      }
      updateCustomDictionary({ add: [word], remove: [row.word] });
      return null;
    }
    if (!workspaceId || !row.entryId) return null;
    try {
      await editSharedWord(workspaceId, row.entryId, word);
      return null;
    } catch (error) {
      const reason = reasonOf(error);
      if (reason === "alreadyInList") {
        return t("dictionary.shared.alreadyIn", { list: sharedListName(row) });
      }
      showActionError(reason, sharedListName(row));
      return null;
    }
  };

  // A selection in All shared can span lists; name each of them once.
  const listNames = (names: string[]): string =>
    new Intl.ListFormat(i18n.language, { type: "conjunction" }).format([...new Set(names)]);

  const entryIdsOf = (rows: DictionaryRow[]): string[] =>
    rows.flatMap((row) => (row.entryId ? [row.entryId] : []));

  const setRowsHidden = async (rows: DictionaryRow[], hidden: boolean): Promise<boolean> => {
    const shared = rows.filter((row) => row.entryId);
    if (!workspaceId || shared.length === 0) return false;
    try {
      await setSharedWordsHidden(workspaceId, entryIdsOf(shared), hidden);
      return true;
    } catch (error) {
      showActionError(reasonOf(error), listNames(shared.map(sharedListName)));
      return false;
    }
  };

  const requestDeleteForEveryone = (rows: DictionaryRow[], onDeleted?: () => void): void => {
    const shared = rows.filter((row) => row.entryId);
    if (shared.length === 0) return;
    setPendingDelete({
      entryIds: entryIdsOf(shared),
      words: shared.map((row) => row.word),
      listName: listNames(shared.map(sharedListName)),
      onDeleted,
    });
  };

  const shareFailureLine = (reason: SharedDictionaryActionReason, lists: string): string => {
    if (reason === "personalChanged") return t("dictionary.shared.share.reasons.personalChanged");
    if (reason === "listFull") return t("dictionary.shared.errors.listFull", { list: lists });
    return t("dictionary.shared.share.reasons.network");
  };

  const shareWords = async (words: string[], targets: ShareTarget[]): Promise<boolean> => {
    if (!workspaceId || words.length === 0 || targets.length === 0) return false;
    const lists = listNames(targets.map(listLabel));
    let moved = 0;
    let failed: { count: number; reason: SharedDictionaryActionReason } | null;
    try {
      const result = await sharePersonalWords(workspaceId, targets, words);
      moved = result.moved.length;
      failed = result.failed
        ? { count: result.failed.words.length, reason: result.failed.reason }
        : null;
    } catch (error) {
      failed = { count: words.length, reason: reasonOf(error) };
    }
    if (!failed) return true;
    if (moved === 0) {
      // Nothing went, so the reason alone says what happened.
      toast({
        title:
          failed.reason === "personalChanged" || failed.reason === "listFull"
            ? shareFailureLine(failed.reason, lists)
            : t("dictionary.shared.errors.generic", { list: lists }),
        variant: "destructive",
      });
      return false;
    }
    toast({
      title: t("dictionary.shared.share.partial", {
        moved,
        total: moved + failed.count,
        failed: failed.count,
      }),
      description: shareFailureLine(failed.reason, lists),
      variant: "destructive",
    });
    return false;
  };

  const undoAction = (
    undo: () => Promise<void>,
    listName: string
  ): { label: string; onClick: () => Promise<void> } => ({
    label: t("dictionary.shared.undo"),
    onClick: async (): Promise<void> => {
      try {
        await undo();
      } catch (error) {
        showActionError(reasonOf(error), listName);
      }
    },
  });

  const runDelete = async ({
    entryIds,
    words,
    listName,
    onDeleted,
  }: PendingSharedDelete): Promise<void> => {
    if (!workspaceId) return;
    try {
      const { undo } = await deleteSharedWords(workspaceId, entryIds);
      onDeleted?.();
      toast({
        title:
          words.length === 1
            ? t("dictionary.shared.deletedForEveryone", { word: words[0] })
            : t("dictionary.shared.deletedManyForEveryone", { count: words.length }),
        actions: [undoAction(undo, listName)],
      });
    } catch (error) {
      // A batch that failed part-way can still restore what it deleted.
      const partialUndo = error instanceof SharedDictionaryActionError ? error.undo : undefined;
      toast({
        title: errorTitle(reasonOf(error), listName),
        variant: "destructive",
        actions: partialUndo ? [undoAction(partialUndo, listName)] : undefined,
      });
    }
  };

  const deleteTitle = pendingDelete
    ? pendingDelete.words.length === 1
      ? t("dictionary.shared.deleteOneTitle", {
          word: pendingDelete.words[0],
          list: pendingDelete.listName,
        })
      : t("dictionary.shared.deleteManyTitle", {
          count: pendingDelete.words.length,
          list: pendingDelete.listName,
        })
    : null;

  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    const request = pendingDelete;
    setPendingDelete(null);
    void runDelete(request);
  };

  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      await Promise.all([syncService.syncSharedDictionaryNow(), syncService.syncDictionaryNow()]);
    } finally {
      setSyncing(false);
    }
  };

  const exportPersonal = async (): Promise<void> => {
    // The export keeps the agent name, as it always has.
    const words = visiblePersonalWords(customDictionary, movedPersonal, snapshot);
    const result = await window.electronAPI?.exportDictionary?.(words);
    if (result?.error) {
      toast({
        title: t("dictionary.exportFailed"),
        description: result.error,
        variant: "destructive",
      });
    }
  };

  return {
    visiblePersonal,
    wordsInTarget,
    addWords,
    editRow,
    setRowsHidden,
    requestDeleteForEveryone,
    shareWords,
    deleteTitle,
    confirmDelete,
    cancelDelete: () => setPendingDelete(null),
    syncing,
    sync,
    exportPersonal,
    clearPersonal: () => updateCustomDictionary({ remove: visiblePersonal }),
  };
}
