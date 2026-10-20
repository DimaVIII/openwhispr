import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "../icons";
import { cn } from "../lib/utils";
import type { ListKey } from "../../stores/sharedDictionaryStore";
import type { PickerEntry } from "./dictionaryViewModel";

interface DictionaryListPickerProps {
  entries: PickerEntry[];
  selected: ListKey;
  onSelect: (list: ListKey) => void;
  // False while the API has no shared dictionary: the group and Hidden are left out.
  showShared: boolean;
}

function PickerButton({
  entry,
  selected,
  onSelect,
}: {
  entry: PickerEntry;
  selected: boolean;
  onSelect: (list: ListKey) => void;
}): ReactElement {
  const nested = entry.key === "workspace" || entry.key.startsWith("space:");
  return (
    <button
      type="button"
      data-list-key={entry.key}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(entry.key)}
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-start text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        nested && "ps-4",
        selected
          ? "bg-card text-foreground shadow-sm dark:bg-surface-2"
          : "text-foreground/55 hover:bg-foreground/4 hover:text-foreground/80 dark:hover:bg-white/5",
        entry.locked && !selected && "opacity-60"
      )}
    >
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {entry.label}
      </span>
      {entry.locked ? (
        <Lock size={11} className="shrink-0 text-foreground/40" aria-hidden="true" />
      ) : (
        entry.count !== null && (
          <span className="shrink-0 tabular-nums text-foreground/40">{entry.count}</span>
        )
      )}
    </button>
  );
}

export function DictionaryListPicker({
  entries,
  selected,
  onSelect,
  showShared,
}: DictionaryListPickerProps): ReactElement {
  const { t } = useTranslation();
  const inGroup = (group: PickerEntry["group"]): PickerEntry[] =>
    entries.filter((entry) => entry.group === group);
  const renderEntry = (entry: PickerEntry): ReactElement => (
    <PickerButton
      key={entry.key}
      entry={entry}
      selected={entry.key === selected}
      onSelect={onSelect}
    />
  );

  return (
    <nav className="flex w-[168px] shrink-0 flex-col gap-0.5 border-e border-foreground/8 pe-3 dark:border-white/8">
      {inGroup("top").map(renderEntry)}
      {showShared && (
        <>
          <p className="px-2 pt-3 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/40">
            {t("dictionary.shared.group")}
          </p>
          {inGroup("shared").map(renderEntry)}
          <div className="my-2 h-px bg-foreground/8 dark:bg-white/8" />
          {inGroup("bottom").map(renderEntry)}
        </>
      )}
    </nav>
  );
}
