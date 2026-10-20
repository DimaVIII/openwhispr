import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, NotebookPen, PanelRight, Plus, Sparkles } from "./icons";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";
import { cn } from "./lib/utils";
import { CARD_SURFACE_CLASS } from "./ui/surfaces";
import { ConfirmDialog } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import SnippetsView from "./SnippetsView";
import DictionaryEmptyIllustration from "./DictionaryEmptyIllustration";
import { DictionaryListPicker } from "./dictionary/DictionaryListPicker";
import { DictionaryToolbar } from "./dictionary/DictionaryToolbar";
import {
  DictionaryAddField,
  type AddTarget,
  type AddTargetOption,
} from "./dictionary/DictionaryAddField";
import { DictionaryWordList } from "./dictionary/DictionaryWordList";
import { useDictionaryActions } from "./dictionary/useDictionaryActions";
import {
  buildPicker,
  defaultAddTarget,
  resolveSharedAccessState,
  rowsForList,
  shareTargetsFor,
  SORT_LABEL_KEYS,
  type DictionaryRow,
  type SortKey,
} from "./dictionary/dictionaryViewModel";
import { useSettings } from "../hooks/useSettings";
import { useWorkspace } from "../hooks/useWorkspace";
import { useAuth } from "../hooks/useAuth";
import { useSharedDictionaryStore, type ListKey } from "../stores/sharedDictionaryStore";
import { getAgentName } from "../utils/agentName";
import { parseDictionaryImportText } from "../helpers/dictionaryImport";
import { getDictionaryHintTiers } from "../utils/snippets";
import { formatDictionaryPrompt, WHISPER_DECODER_PROMPT_CHARS } from "../utils/dictionaryPromptCap";

const SORT_STORAGE_KEY = "dictionarySort";
const ADD_TARGET_STORAGE_KEY = "dictionaryAddTarget";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts for this visit only.
  }
}

function readSort(): SortKey {
  const stored = readStorage(SORT_STORAGE_KEY);
  return stored !== null && Object.hasOwn(SORT_LABEL_KEYS, stored) ? (stored as SortKey) : "az";
}

// "personal", null (the workspace list) or a space id; undefined when nothing valid is stored.
function readRememberedTarget(): AddTarget | undefined {
  const stored = readStorage(ADD_TARGET_STORAGE_KEY);
  if (stored === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null) return null;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const isSharedList = (list: ListKey): boolean => list !== "all" && list !== "personal";
const sameWord = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

export default function DictionaryView() {
  const { t } = useTranslation();
  const { customDictionary, updateCustomDictionary, snippets } = useSettings();
  const { active: workspace } = useWorkspace();
  const { isSignedIn, user } = useAuth();
  const agentName = getAgentName();

  const status = useSharedDictionaryStore((state) => state.status);
  const snapshot = useSharedDictionaryStore((state) => state.snapshot);
  const movedPersonal = useSharedDictionaryStore((state) => state.movedPersonal);
  const storeSyncing = useSharedDictionaryStore((state) => state.syncing);
  const lastSyncedAt = useSharedDictionaryStore((state) => state.lastSyncedAt);
  const requestedList = useSharedDictionaryStore((state) => state.requestedList);

  const [tab, setTab] = useState("dictionary");
  const [list, setList] = useState<ListKey>(requestedList ?? "all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>(readSort);
  const [rememberedTarget, setRememberedTarget] = useState<AddTarget | undefined>(
    readRememberedTarget
  );
  // A target picked from the chip holds for the list it was picked on.
  const [pickedTarget, setPickedTarget] = useState<{ list: ListKey; target: AddTarget } | null>(
    null
  );
  const [bulkText, setBulkText] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // A window's snapshot only refreshes where the last sync pass ran, so the page
  // rereads the local mirror whenever it opens.
  useEffect(() => {
    void useSharedDictionaryStore.getState().reload();
  }, []);

  // The arrival toast's "View words" can ask for a list while the page is open.
  useEffect(() => {
    if (!requestedList) return;
    setList(requestedList);
    useSharedDictionaryStore.getState().setRequestedList(null);
  }, [requestedList]);

  const workspaceId = workspace?.id ?? null;
  const workspaceName = workspace?.name ?? "";
  const access = resolveSharedAccessState({
    capabilityAvailable: status !== "unavailable",
    workspace,
    serverPaused: snapshot?.meta?.paused ?? null,
  });

  // Same membership rule as agentNameDictionaryChanges: a stored spelling that
  // differs only by case is still the agent name's entry, so keep it hidden.
  const userWords = useMemo(() => {
    const agentWord = agentName.trim().toLowerCase();
    return customDictionary.filter((word) => word.trim().toLowerCase() !== agentWord);
  }, [customDictionary, agentName]);

  const pickerEntries = useMemo(
    () => buildPicker({ personal: userWords, movedPersonal, snapshot, workspaceName, access, t }),
    [userWords, movedPersonal, snapshot, workspaceName, access, t]
  );

  // A list the member lost (a space they left, the feature switched off) falls back to All words.
  const openList: ListKey =
    pickerEntries.some((entry) => entry.key === list) &&
    (access !== "unavailable" || !isSharedList(list))
      ? list
      : "all";
  const openEntry = pickerEntries.find((entry) => entry.key === openList);
  const locked = isSharedList(openList) && access !== "available";

  const rows = useMemo(
    () =>
      rowsForList(openList, {
        personal: userWords,
        movedPersonal,
        snapshot,
        workspaceName,
        currentUserId: user?.id ?? null,
        search,
        sort,
        access,
      }),
    [openList, userWords, movedPersonal, snapshot, workspaceName, user?.id, search, sort, access]
  );

  const addTargets = useMemo((): AddTargetOption[] => {
    const personal: AddTargetOption = {
      target: "personal",
      label: t("dictionary.shared.personal"),
    };
    if (access !== "available" || !snapshot?.meta) return [personal];
    const shared = shareTargetsFor([], snapshot, workspaceName, t);
    return [personal, ...shared.map(({ target, label }) => ({ target, label }))];
  }, [access, snapshot, workspaceName, t]);

  const isWritable = (target: AddTarget | undefined): target is AddTarget =>
    target !== undefined && addTargets.some((option) => option.target === target);
  const preferredTarget =
    pickedTarget?.list === openList
      ? pickedTarget.target
      : defaultAddTarget(openList, isWritable(rememberedTarget) ? rememberedTarget : undefined);
  const addTarget: AddTarget = isWritable(preferredTarget) ? preferredTarget : "personal";

  const listLabel = (target: AddTarget): string =>
    addTargets.find((option) => option.target === target)?.label ?? t("dictionary.shared.personal");

  const rememberTarget = (target: AddTarget): void => {
    setRememberedTarget(target);
    writeStorage(ADD_TARGET_STORAGE_KEY, JSON.stringify(target));
  };

  // Length of the user's own part of the STT prompt (words + snippet triggers,
  // comma-joined). Team words are left out: members can't edit them, and they
  // are dropped first, so Whisper keeps the personal words at the prompt's tail.
  // A Chinese script bias adds ~21 chars on top for zh-CN / zh-TW users.
  const promptChars = useMemo(
    () =>
      formatDictionaryPrompt([getDictionaryHintTiers({ customDictionary, snippets })[0]], Infinity)
        .length,
    [customDictionary, snippets]
  );

  const pendingImportCount = useMemo(() => parseDictionaryImportText(bulkText).length, [bulkText]);

  const actions = useDictionaryActions({
    workspaceId,
    workspaceName,
    customDictionary,
    userWords,
    agentName,
    updateCustomDictionary,
    movedPersonal,
    snapshot,
    listLabel,
  });
  const { visiblePersonal } = actions;

  const addWords = (text: string): Promise<boolean> => {
    rememberTarget(addTarget);
    return actions.addWords(text, addTarget);
  };

  const handleImport = async (): Promise<void> => {
    if (await addWords(bulkText)) {
      setBulkText("");
      setShowBulkImport(false);
    }
  };

  const selectList = (next: ListKey): void => {
    setList(next);
    setSearch("");
  };

  const personalView = openList === "all" || openList === "personal";
  const listIsEmpty = rows.length === 0 && search.trim() === "";
  const openScope =
    openList === "workspace" || openList.startsWith("space:")
      ? snapshot?.meta?.scopes.find(
          (scope) =>
            scope.space_id === (openList === "workspace" ? null : openList.slice("space:".length))
        )
      : undefined;
  const headerDetail = openScope
    ? t("dictionary.shared.memberCount", { count: openScope.member_count })
    : String(rows.length);

  const emptyPersonalState = (
    <div className="flex min-h-64 items-start px-6 py-6">
      <div className="relative z-10 w-full min-w-0 md:w-3/5">
        <h2 className="text-xl font-normal text-foreground">{t("dictionary.emptyTitle")}</h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-foreground/50 dark:text-foreground/65">
          {t("dictionary.emptyDescription", { agentName })}
        </p>
        <Button className="mt-6 px-5 font-normal" onClick={() => addInputRef.current?.focus()}>
          <Plus size={16} />
          {t("dictionary.addFirstWord")}
        </Button>
      </div>
      <DictionaryEmptyIllustration variant="dictionary" />
    </div>
  );

  const listCard =
    personalView && listIsEmpty ? (
      <div
        className={cn(
          CARD_SURFACE_CLASS,
          "relative overflow-hidden rounded-3xl shadow-sm dark:bg-surface-window"
        )}
      >
        {emptyPersonalState}
      </div>
    ) : (
      <div className={cn(CARD_SURFACE_CLASS, "rounded-lg px-4 py-3 shadow-sm")}>
        <div className="flex items-center justify-between gap-3 border-b border-dashed border-foreground/10 pb-2 dark:border-white/10">
          <h3 dir="auto" className="truncate text-[11px] font-semibold text-foreground/45">
            {openEntry?.label} · {headerDetail}
          </h3>
          <div className="flex shrink-0 items-center gap-3">
            {openList === "personal" && visiblePersonal.length > 0 && (
              <>
                <button
                  onClick={() => setConfirmClear(true)}
                  aria-label={t("dictionary.clearAll")}
                  className="text-[11px] text-foreground/45 transition-colors hover:text-destructive/70"
                >
                  {t("dictionary.clearAll")}
                </button>
                <button
                  onClick={() => void actions.exportPersonal()}
                  aria-label={t("dictionary.exportDictionary")}
                  className="text-foreground/45 transition-colors hover:text-foreground/60"
                >
                  <Download size={12} />
                </button>
              </>
            )}
            <span className="text-[10px] text-foreground/40">{t(SORT_LABEL_KEYS[sort])}</span>
          </div>
        </div>
        {rows.length === 0 ? (
          <p dir="auto" className="py-6 text-center text-xs text-foreground/45">
            {listIsEmpty
              ? t("dictionary.shared.emptyList", { list: openEntry?.label ?? "" })
              : t("dictionary.shared.noMatches", { query: search.trim() })}
          </p>
        ) : (
          <DictionaryWordList
            rows={rows}
            hiddenList={openList === "hidden"}
            onEdit={actions.editRow}
            onDelete={(row) => updateCustomDictionary({ remove: [row.word] })}
            onHide={(row) => void actions.setRowsHidden([row], true)}
            onUnhide={(row) => void actions.setRowsHidden([row], false)}
            onDeleteForEveryone={(row) => actions.requestDeleteForEveryone([row])}
          />
        )}
      </div>
    );

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col h-full">
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("dictionary.clearTitle")}
        description={t("dictionary.clearDescription")}
        onConfirm={actions.clearPersonal}
        variant="destructive"
      />
      <ConfirmDialog
        open={actions.deleteTitle !== null}
        onOpenChange={(open) => {
          if (!open) actions.cancelDelete();
        }}
        title={actions.deleteTitle ?? ""}
        confirmText={t("dictionary.shared.actions.deleteForEveryone")}
        onConfirm={actions.confirmDelete}
        variant="destructive"
      />

      <div
        className={cn(
          PAGE_CONTENT_WIDTH_CLASS,
          "flex items-center justify-between gap-3 px-6 pt-6"
        )}
      >
        <TabsList variant="pill">
          <TabsTrigger value="dictionary" variant="pill">
            <NotebookPen size={17} />
            {t("dictionary.tabDictionary")}
          </TabsTrigger>
          <TabsTrigger value="snippets" variant="pill">
            <PanelRight size={17} />
            {t("dictionary.tabSnippets")}
          </TabsTrigger>
        </TabsList>
        {tab === "dictionary" && (
          <DictionaryToolbar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              writeStorage(SORT_STORAGE_KEY, next);
            }}
            showSync={isSignedIn}
            syncing={storeSyncing || actions.syncing}
            lastSyncedAt={lastSyncedAt}
            onSync={() => void actions.sync()}
          />
        )}
      </div>

      <TabsContent value="dictionary" className="flex-1 min-h-0 mt-0 overflow-y-auto">
        <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "flex gap-5 px-6 py-5")}>
          <DictionaryListPicker
            entries={pickerEntries}
            selected={openList}
            onSelect={selectList}
            showShared={access !== "unavailable"}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {locked ? (
              // Placeholder for a list the member can't use; the blocked states fill it.
              <div className={cn(CARD_SURFACE_CLASS, "min-h-40 rounded-lg")} />
            ) : (
              <>
                <DictionaryAddField
                  target={addTarget}
                  targets={addTargets}
                  onTargetChange={(target) => {
                    setPickedTarget({ list: openList, target });
                    rememberTarget(target);
                  }}
                  onAdd={addWords}
                  isInTarget={(word) =>
                    actions.wordsInTarget(addTarget).some((existing) => sameWord(existing, word))
                  }
                  onImport={() => setShowBulkImport(true)}
                  inputRef={addInputRef}
                />

                {/* ─── Bulk import ─── */}
                {showBulkImport && (
                  <div className="rounded-md border border-primary/30 dark:border-primary/40 px-3 pt-2.5 pb-2">
                    <Textarea
                      dir="auto"
                      autoFocus
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      placeholder={t("dictionary.importPlaceholder")}
                      rows={4}
                      className="min-h-[72px] resize-none border-0 shadow-none rounded-none bg-transparent p-0 text-xs text-foreground placeholder:text-foreground/45 hover:border-0 focus:border-0 focus:ring-0"
                    />
                    <div className="flex items-center justify-between pt-1.5">
                      <p className="text-xs text-foreground/45">
                        {t("dictionary.separateWithCommas")}
                        {pendingImportCount > 0 && (
                          <span className="text-success">
                            {" • "}
                            {t("dictionary.wordsReady", { count: pendingImportCount })}
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setBulkText("");
                            setShowBulkImport(false);
                          }}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void handleImport()}
                          disabled={pendingImportCount === 0}
                        >
                          {t("dictionary.shared.importTo", { list: listLabel(addTarget) })}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── Agent name (always recognized) ─── */}
                {personalView && !listIsEmpty && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/15 bg-primary/3 px-4 py-2.5 dark:border-primary/20 dark:bg-primary/6">
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles size={11} className="text-primary/70 shrink-0" />
                      <span dir="auto" className="text-xs font-medium text-primary truncate">
                        {agentName}
                      </span>
                    </div>
                    <span className="text-xs text-foreground/45 shrink-0">
                      {t("dictionary.agentDefault")}
                    </span>
                  </div>
                )}

                {listCard}
              </>
            )}

            {/* ─── Provider prompt-limit notice ─── */}
            {promptChars > WHISPER_DECODER_PROMPT_CHARS && (
              <p className="text-xs text-foreground/45 leading-relaxed">
                {t("dictionary.promptLimitNotice", { chars: promptChars })}
              </p>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="snippets" className="flex-1 min-h-0 mt-0 overflow-y-auto">
        <SnippetsView />
      </TabsContent>
    </Tabs>
  );
}
