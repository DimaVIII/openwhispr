import { useState, type ReactElement, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, CornerDownLeft, Upload } from "../icons";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { ShareTarget } from "../../services/sharedDictionaryActions";

export type AddTarget = ShareTarget | "personal";

export interface AddTargetOption {
  target: AddTarget;
  label: string;
}

interface DictionaryAddFieldProps {
  target: AddTarget;
  targets: AddTargetOption[];
  onTargetChange: (target: AddTarget) => void;
  // Resolves true once the words were added, which clears the field.
  onAdd: (text: string) => Promise<boolean>;
  // Whether one typed word is already in the target list.
  isInTarget: (word: string) => boolean;
  onImport: () => void;
  inputRef?: Ref<HTMLInputElement>;
}

export function DictionaryAddField({
  target,
  targets,
  onTargetChange,
  onAdd,
  isInTarget,
  onImport,
  inputRef,
}: DictionaryAddFieldProps): ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const targetLabel =
    targets.find((option) => option.target === target)?.label ?? t("dictionary.shared.personal");
  const trimmed = text.trim();
  // A comma list adds whatever is new; only a single known word is refused.
  const alreadyAdded = trimmed !== "" && !trimmed.includes(",") && isInTarget(trimmed);
  const canAdd = trimmed !== "" && !alreadyAdded && !busy;

  const submit = async (): Promise<void> => {
    if (!canAdd) return;
    setBusy(true);
    try {
      if (await onAdd(text)) setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-card ps-3 pe-1.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 dark:border-white/10 dark:bg-surface-1">
      <Input
        dir="auto"
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder={t("dictionary.shared.add.placeholder")}
        aria-invalid={alreadyAdded || undefined}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs shadow-none placeholder:text-foreground/45 hover:border-0 focus-visible:ring-0 dark:bg-transparent"
      />
      {alreadyAdded ? (
        <span className="shrink-0 text-[11px] text-foreground/45">
          {t("dictionary.shared.alreadyIn", { list: targetLabel })}
        </span>
      ) : (
        trimmed !== "" && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canAdd}
            aria-label={t("dictionary.addWord")}
            className="flex shrink-0 items-center gap-1 text-[11px] text-foreground/45 transition-colors enabled:hover:text-primary"
          >
            {t("dictionary.add")}
            <CornerDownLeft size={11} />
          </button>
        )
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("dictionary.shared.add.chooseList")}
            className="flex h-6 max-w-48 shrink-0 items-center gap-1 rounded-[5px] border border-foreground/8 bg-foreground/3 px-2 text-[11px] text-foreground/80 transition-colors hover:bg-foreground/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-white/8 dark:bg-white/4"
          >
            <span dir="auto" className="truncate">
              {t("dictionary.shared.add.to", { list: targetLabel })}
            </span>
            <ChevronDown size={11} className="shrink-0 text-foreground/45" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44 rounded-lg p-1">
          {targets.map((option) => (
            <DropdownMenuItem
              key={option.target ?? "workspace"}
              onSelect={() => onTargetChange(option.target)}
              className="gap-2 rounded-md px-2 py-1.5 text-xs"
            >
              <span dir="auto" className="flex-1 truncate">
                {option.label}
              </span>
              {option.target === target && <Check size={12} className="text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-px bg-foreground/10 dark:bg-white/8" />
      <button
        type="button"
        onClick={onImport}
        aria-label={t("dictionary.importWords")}
        className="grid size-6 shrink-0 place-items-center rounded-[5px] text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground/70"
      >
        <Upload size={13} />
      </button>
    </div>
  );
}
