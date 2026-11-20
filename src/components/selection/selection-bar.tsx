"use client";

import { Check, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The visible "Select" entry of a list: an icon button that stays pressed while select mode is on.
 * `label` names what is selected ("Select activities"); pass `children` for a button with text.
 */
export function SelectToggle({ selecting, onToggle, label, disabled, className, children }: {
  selecting: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Button
      variant={selecting ? "default" : "outline"}
      size={children ? "default" : "icon"}
      className={className}
      aria-label={children ? undefined : label}
      aria-pressed={selecting}
      disabled={disabled}
      onClick={onToggle}
    >
      <ListChecks aria-hidden />
      {children}
    </Button>
  );
}

/**
 * The tick drawn at the start of a selectable row. Decorative: the row itself carries
 * role="checkbox" and aria-checked. Checked is a filled disc with a check mark, never colour alone.
 */
export function SelectionCheck({ selected, disabled, className }: { selected: boolean; disabled?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        disabled && "border-dashed opacity-50",
        className,
      )}
    >
      {selected ? <Check className="size-4" strokeWidth={3} /> : null}
    </span>
  );
}

/** "Select all" that turns into "Clear" once everything tickable is ticked. */
export function SelectAll({ allPicked, onToggle, disabled, className }: {
  allPicked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("Selection");
  return (
    <Button variant="ghost" size="sm" className={className} disabled={disabled} onClick={onToggle}>
      {allPicked ? t("clear") : t("selectAll")}
    </Button>
  );
}

/**
 * The bar of a list in select mode. It sticks above the phone's bottom navigation and its raised
 * Add button (and at the bottom of the content on wider screens), inside the safe area.
 *
 * Top to bottom: an optional `summary` (for example totals per currency), then how many rows are
 * ticked with Select all / Clear and Done, then the bulk actions passed as `children` (one row of
 * equal buttons, each at least 44px tall). Give a destructive action `variant="destructive"` and
 * confirm it in a ConfirmSheet that names the count.
 */
export function SelectionBar({ label, count, allPicked, onToggleAll, onDone, summary, children, className }: {
  /** Accessible name of the region, e.g. "Selected activities". */
  label: string;
  count: number;
  allPicked: boolean;
  onToggleAll: () => void;
  onDone: () => void;
  summary?: React.ReactNode;
  /** Bulk action buttons. */
  children?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("Selection");
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        "sticky bottom-[calc(120px+var(--safe-bottom))] z-20 mt-1 flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-lg md:bottom-4",
        className,
      )}
    >
      {summary}
      <div className="flex items-center gap-1">
        <p aria-live="polite" className="min-w-0 flex-1 text-sm font-medium">{t("selectedCount", { count })}</p>
        <SelectAll allPicked={allPicked} onToggle={onToggleAll} />
        <Button variant="ghost" size="sm" onClick={onDone}>{t("done")}</Button>
      </div>
      {children ? <div className="grid auto-cols-fr grid-flow-col gap-2">{children}</div> : null}
    </div>
  );
}
