import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../ui/useToast";
import {
  SharedDictionaryActionError,
  addSharedWords,
  deleteSharedWords,
  editSharedWord,
  setSharedWordsHidden,
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
}

export interface DictionaryActions {
  // Personal words the member can see; clear-all removes exactly these.
  visiblePersonal: string[];
  wordsInTarget: (target: AddTarget) => string[];
  // Resolves true once nothing is left to add, which clears the field.
  addWords: (text: string, target: AddTarget) => Promise<boolean>;
  // Resolves an error to show in the open editor, or null to close it.
  editRow: (row: DictionaryRow, word: string) => Promise<string | null>;
  setRowsHidden: (rows: DictionaryRow[], hidden: boolean) => Promise<void>;
  // Delete for everyone always asks first; the dialog reads `deleteTitle`.
  requestDeleteForEveryone: (rows: DictionaryRow[]) => void;
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
  const { t } = useTranslation();
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

  const entryIdsOf = (rows: DictionaryRow[]): string[] =>
    rows.flatMap((row) => (row.entryId ? [row.entryId] : []));

  const setRowsHidden = async (rows: DictionaryRow[], hidden: boolean): Promise<void> => {
    const entryIds = entryIdsOf(rows);
    if (!workspaceId || entryIds.length === 0) return;
    try {
      await setSharedWordsHidden(workspaceId, entryIds, hidden);
    } catch (error) {
      showActionError(reasonOf(error), sharedListName(rows[0]));
    }
  };

  const requestDeleteForEveryone = (rows: DictionaryRow[]): void => {
    const shared = rows.filter((row) => row.entryId);
    if (shared.length === 0) return;
    setPendingDelete({
      entryIds: entryIdsOf(shared),
      words: shared.map((row) => row.word),
      listName: sharedListName(shared[0]),
    });
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

  const runDelete = async ({ entryIds, words, listName }: PendingSharedDelete): Promise<void> => {
    if (!workspaceId) return;
    try {
      const { undo } = await deleteSharedWords(workspaceId, entryIds);
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
    deleteTitle,
    confirmDelete,
    cancelDelete: () => setPendingDelete(null),
    syncing,
    sync,
    exportPersonal,
    clearPersonal: () => updateCustomDictionary({ remove: visiblePersonal }),
  };
}
