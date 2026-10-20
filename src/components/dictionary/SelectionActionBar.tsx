import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, X } from "../icons";
import { cn } from "../lib/utils";

// Bottom padding the list takes while the bar floats over it, so the bar
// (h-10, pulled up by -mt-15 below) never covers the last row.
export const SELECTION_BAR_CLEARANCE_CLASS = "pb-14";

interface SelectionActionBarProps {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  // Personal words in the selection: Delete, and Share once there's a list to share to.
  onDelete?: () => void;
  onShare?: (anchor: HTMLElement) => void;
  shareOpen?: boolean;
  // Shared words in the selection.
  onHide?: () => void;
  onDeleteForEveryone?: () => void;
}

const QUIET_BUTTON_CLASS =
  "rounded-[5px] px-1 text-[11px] text-background/70 transition-colors hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/40";
const SOLID_BUTTON_CLASS =
  "flex h-6 items-center gap-1 rounded-md bg-background px-2.5 text-[11px] font-medium transition-colors hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/40";

function QuietButton({
  onClick,
  children,
  ariaLabel,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(QUIET_BUTTON_CLASS, className)}
    >
      {children}
    </button>
  );
}

export function SelectionActionBar({
  count,
  total,
  onSelectAll,
  onClear,
  onDelete,
  onShare,
  shareOpen = false,
  onHide,
  onDeleteForEveryone,
}: SelectionActionBarProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t("dictionary.shared.selection.label")}
      className="sticky bottom-3 z-20 -mt-15 flex h-10 w-[min(100%,34rem)] items-center justify-between gap-3 self-center rounded-lg bg-foreground ps-3 pe-2 text-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className="shrink-0 font-medium tabular-nums">
          {t("dictionary.shared.selection.count", { count })}
        </span>
        {count < total && (
          <>
            <span aria-hidden="true" className="text-background/40">
              ·
            </span>
            <span className="truncate">
              <QuietButton onClick={onSelectAll}>
                {t("dictionary.shared.selection.selectAll", { total })}
              </QuietButton>
            </span>
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        {onHide && (
          <QuietButton onClick={onHide}>{t("dictionary.shared.actions.hide")}</QuietButton>
        )}
        {onDelete && (
          <QuietButton onClick={onDelete}>{t("dictionary.shared.actions.delete")}</QuietButton>
        )}
        {onShare && (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={shareOpen}
            onClick={(event) => onShare(event.currentTarget)}
            className={cn(SOLID_BUTTON_CLASS, "text-foreground")}
          >
            {t("dictionary.shared.selection.shareWith")}
            <ChevronDown size={11} />
          </button>
        )}
        {onDeleteForEveryone && (
          <button
            type="button"
            onClick={onDeleteForEveryone}
            className={cn(SOLID_BUTTON_CLASS, "text-destructive")}
          >
            {t("dictionary.shared.actions.deleteForEveryone")}
          </button>
        )}
        <QuietButton
          onClick={onClear}
          ariaLabel={t("dictionary.shared.selection.clear")}
          className="grid size-6 place-items-center px-0"
        >
          <X size={12} />
        </QuietButton>
      </span>
    </div>
  );
}
