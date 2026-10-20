import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Pencil, Trash2, Users } from "../icons";
import { Input } from "../ui/input";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../lib/utils";
import type { DictionaryRow } from "./dictionaryViewModel";
import { RowCheckbox } from "./RowCheckbox";

export interface WordListSelection {
  isSelected: (key: string) => boolean;
  // Anything selected: every row shows its checkbox and the hover actions step aside.
  active: boolean;
  // extend is a Shift-click, which ticks the range from the last ticked row.
  onToggle: (row: DictionaryRow, extend: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

interface DictionaryWordListProps {
  rows: DictionaryRow[];
  // Rows of the Hidden list, which can only be unhidden.
  hiddenList: boolean;
  // Resolves an error to show under the open editor, or null to close it.
  onEdit: (row: DictionaryRow, word: string) => Promise<string | null>;
  onDelete: (row: DictionaryRow) => void;
  onHide: (row: DictionaryRow) => void;
  onDeleteForEveryone: (row: DictionaryRow) => void;
  onUnhide: (row: DictionaryRow) => void;
  // Personal rows only show Share once there is somewhere to share to. The
  // anchor is the clicked icon, which the share popover opens from.
  onShare?: (row: DictionaryRow, anchor: HTMLElement) => void;
  // Lists without bulk actions (Hidden) have no checkboxes.
  selection?: WordListSelection;
  // A paused list's words can be read, not changed: the rows have no actions.
  readOnly?: boolean;
}

interface RowAction {
  // The tooltip stays short; the accessible name says which word it acts on.
  label: string;
  ariaLabel: string;
  icon: ReactNode;
  onClick: (anchor: HTMLElement) => void;
  destructive?: boolean;
}

function RowActionButton({ action }: { action: RowAction }): ReactElement {
  return (
    <Tooltip content={action.label}>
      <button
        type="button"
        aria-label={action.ariaLabel}
        onClick={(event) => action.onClick(event.currentTarget)}
        className={cn(
          "grid size-6 place-items-center rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
          action.destructive
            ? "text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
            : "text-foreground/55 hover:bg-foreground/6 hover:text-foreground/85 dark:hover:bg-white/8"
        )}
      >
        {action.icon}
      </button>
    </Tooltip>
  );
}

function RowMeta({ row }: { row: DictionaryRow }): ReactElement | null {
  const { t } = useTranslation();
  const attribution =
    row.attribution === "you"
      ? t("dictionary.shared.attribution.you")
      : row.attribution === "former"
        ? t("dictionary.shared.attribution.former")
        : (row.attribution?.name ?? null);
  if (!row.badge && !attribution) return null;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {attribution && (
        <span dir="auto" className="max-w-32 truncate text-[11px] text-foreground/45">
          {attribution}
        </span>
      )}
      {row.badge && (
        <span
          dir="auto"
          className="max-w-32 truncate rounded-[4px] bg-foreground/6 px-1.5 py-px text-[10px] text-foreground/55 dark:bg-white/8"
        >
          {row.badge}
        </span>
      )}
    </span>
  );
}

function RowEditor({
  row,
  onCommit,
  onCancel,
}: {
  row: DictionaryRow;
  onCommit: (word: string) => Promise<string | null>;
  onCancel: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [value, setValue] = useState(row.word);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const commit = async (): Promise<void> => {
    // An empty word is never sent: the editor stays open until it has one.
    if (saving || value.trim() === "") return;
    setSaving(true);
    try {
      setError(await onCommit(value.trim()));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        dir="auto"
        autoFocus
        value={value}
        // readOnly rather than disabled, so a refused save keeps the focus here.
        readOnly={saving}
        aria-label={t("dictionary.editWord", { word: row.word })}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") onCancel();
        }}
        onBlur={() => void commit()}
        className="h-7 min-w-0 flex-1 rounded-md text-xs"
      />
      {error && <span className="shrink-0 text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

export function DictionaryWordList({
  rows,
  hiddenList,
  onEdit,
  onDelete,
  onHide,
  onDeleteForEveryone,
  onUnhide,
  onShare,
  selection,
  readOnly = false,
}: DictionaryWordListProps): ReactElement {
  const { t } = useTranslation();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Only while the list itself has focus: the add field and the row editor keep
  // ⌘A for their text.
  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (!selection) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selection.onSelectAll();
    } else if (event.key === "Escape" && selection.active) {
      event.preventDefault();
      selection.onClear();
    }
  };

  const actionsFor = (row: DictionaryRow): RowAction[] => {
    const action = (
      labelKey: string,
      ariaLabelKey: string,
      icon: ReactNode,
      onClick: (anchor: HTMLElement) => void,
      destructive = false
    ): RowAction => ({
      label: t(labelKey),
      ariaLabel: t(ariaLabelKey, { word: row.word }),
      icon,
      onClick,
      destructive,
    });
    const edit = action(
      "dictionary.shared.actions.edit",
      "dictionary.editWord",
      <Pencil size={13} />,
      () => setEditingKey(row.key)
    );
    if (hiddenList) {
      return [
        action(
          "dictionary.shared.actions.unhide",
          "dictionary.shared.actions.unhideWord",
          <Eye size={13} />,
          () => onUnhide(row)
        ),
      ];
    }
    if (row.kind === "personal") {
      const share = onShare
        ? [
            action(
              "dictionary.shared.actions.share",
              "dictionary.shared.actions.shareWord",
              <Users size={13} />,
              (anchor) => onShare(row, anchor)
            ),
          ]
        : [];
      return [
        ...share,
        edit,
        action(
          "dictionary.shared.actions.delete",
          "dictionary.shared.actions.deleteWord",
          <Trash2 size={13} />,
          () => onDelete(row)
        ),
      ];
    }
    return [
      edit,
      action(
        "dictionary.shared.actions.hide",
        "dictionary.shared.actions.hideWord",
        <EyeOff size={13} />,
        () => onHide(row)
      ),
      action(
        "dictionary.shared.actions.deleteForEveryone",
        "dictionary.shared.actions.deleteForEveryoneWord",
        <Trash2 size={13} />,
        () => onDeleteForEveryone(row),
        true
      ),
    ];
  };

  return (
    // Focusable so a click on a row gives the list focus for ⌘A.
    <ul tabIndex={-1} onKeyDown={handleKeyDown} className="outline-none">
      {rows.map((row) => {
        const editing = editingKey === row.key;
        const selected = selection?.isSelected(row.key) ?? false;
        return (
          <li
            key={row.key}
            data-word={row.word}
            className={cn(
              "group relative -mx-2 flex h-[38px] items-center gap-2 rounded-md border-b border-foreground/4 px-2 last:border-b-0 dark:border-white/6",
              selected
                ? "bg-primary/8 dark:bg-primary/12"
                : "hover:bg-foreground/[0.025] dark:hover:bg-white/[0.03]"
            )}
          >
            {selection && (
              // A fixed column, so ticking the first row shifts nothing.
              <RowCheckbox
                checked={selected}
                label={t("dictionary.shared.selection.selectWord", { word: row.word })}
                onToggle={(event) => selection.onToggle(row, event.shiftKey)}
                className={cn(
                  "size-5 shrink-0 justify-center transition-opacity duration-150",
                  selection.active
                    ? "opacity-100"
                    : "opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                )}
              />
            )}
            {editing ? (
              <RowEditor
                row={row}
                onCancel={() => setEditingKey(null)}
                onCommit={async (word) => {
                  const error = await onEdit(row, word);
                  if (!error) setEditingKey(null);
                  return error;
                }}
              />
            ) : (
              <>
                <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-foreground/75">
                  {row.word}
                </span>
                <span
                  className={cn(
                    "transition-opacity duration-150",
                    !selection?.active &&
                      !readOnly &&
                      "group-focus-within:opacity-0 group-hover:opacity-0"
                  )}
                >
                  <RowMeta row={row} />
                </span>
                {!selection?.active && !readOnly && (
                  <div className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                    {actionsFor(row).map((action) => (
                      <RowActionButton key={action.label} action={action} />
                    ))}
                  </div>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
