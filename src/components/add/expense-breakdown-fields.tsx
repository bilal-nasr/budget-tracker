"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Plus, Trash2 } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  MAX_EXPENSE_ITEMS,
  MAX_ITEM_DESCRIPTION_LENGTH,
  parseExpenseItemDrafts,
  type ExpenseItemDraft,
} from "@/features/transactions/breakdown";
import { CURRENCY_DECIMALS, parseAmount, type Currency } from "@/lib/money";
import type { ExpenseBreakdownLabels } from "./expense-breakdown-labels";
export { useExpenseBreakdownLabels, type ExpenseBreakdownLabels } from "./expense-breakdown-labels";

export type ExpenseBreakdownFieldsProps = {
  currency: Currency;
  parentMinor: number | null;
  items: ExpenseItemDraft[];
  onChange: (next: ExpenseItemDraft[]) => void;
  labels: ExpenseBreakdownLabels;
  disabled?: boolean;
};

/** Optional, controlled composition of one expense. Saving is the parent's job. */
export function ExpenseBreakdownFields({
  currency, parentMinor, items, onChange, labels, disabled = false,
}: ExpenseBreakdownFieldsProps) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(items.length > 0);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const descriptions = useRef(new Map<string, HTMLInputElement>());
  const focusOnMount = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const result = parseExpenseItemDrafts(currency, parentMinor, items);
  const summary = result.valid ? result.summary : null;

  const markTouched = (key: string) => setTouched((previous) => new Set(previous).add(key));
  const change = (key: string, patch: Partial<ExpenseItemDraft>) =>
    onChange(items.map((item) => item.key === key ? { ...item, ...patch } : item));

  const add = () => {
    if (disabled || items.length >= MAX_EXPENSE_ITEMS) return;
    const key = crypto.randomUUID();
    focusOnMount.current = key;
    onChange([...items, { key, description: "", amountText: "" }]);
  };
  const remove = (index: number) => {
    if (disabled) return;
    const next = items.filter((_, i) => i !== index);
    onChange(next);
    const focusKey = next[index]?.key ?? next[index - 1]?.key;
    if (focusKey) descriptions.current.get(focusKey)?.focus();
    else addButton.current?.focus();
  };

  return (
    <section className="border-t border-border">
      <button type="button" aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 text-start text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <span>{labels.title}</span>
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          {items.length > 0 ? <span className="text-[13px]">{labels.itemCount(items.length)}</span> : null}
          <ChevronDown aria-hidden className={`size-4 shrink-0 motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded ? (
        <div id={contentId} className="flex flex-col gap-3 pb-3">
          <ol className="flex flex-col divide-y divide-border">
            {items.map((item, index) => {
              const descriptionInvalid = touched.has(`${item.key}-description`) &&
                (item.description.trim().length === 0 || item.description.trim().length > MAX_ITEM_DESCRIPTION_LENGTH);
              const amount = parseAmount(item.amountText, currency);
              const amountInvalid = touched.has(`${item.key}-amount`) && (amount === null || amount < 1);
              return (
                <li key={item.key} className="flex flex-col gap-3 py-3 first:pt-0">
                  <div className="flex items-end gap-2">
                    <TextField className="min-w-0 flex-1" label={labels.description} value={item.description}
                      ref={(node) => {
                        if (node) {
                          descriptions.current.set(item.key, node);
                          if (focusOnMount.current === item.key) {
                            focusOnMount.current = null;
                            node.focus();
                          }
                        } else descriptions.current.delete(item.key);
                      }}
                      onChange={(event) => change(item.key, { description: event.target.value })}
                      onBlur={() => markTouched(`${item.key}-description`)}
                      maxLength={MAX_ITEM_DESCRIPTION_LENGTH} disabled={disabled} autoComplete="off" enterKeyHint="next"
                      error={descriptionInvalid ? labels.invalidDescription : undefined} />
                    <Button type="button" variant="ghost" size="icon" disabled={disabled}
                      aria-label={labels.removeItem(index + 1)} onClick={() => remove(index)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  <TextField label={`${labels.amount} · ${currency}`} aria-label={labels.amount}
                    value={item.amountText} dir="ltr" inputMode={CURRENCY_DECIMALS[currency] === 0 ? "numeric" : "decimal"}
                    onChange={(event) => change(item.key, { amountText: event.target.value })}
                    onBlur={() => markTouched(`${item.key}-amount`)}
                    error={amountInvalid ? labels.invalidAmount : undefined}
                    disabled={disabled} autoComplete="off" enterKeyHint="done" />
                </li>
              );
            })}
          </ol>
          <Button ref={addButton} type="button" variant="outline" className="self-start"
            onClick={add} disabled={disabled || items.length >= MAX_EXPENSE_ITEMS}>
            <Plus aria-hidden />{labels.addItem}
          </Button>
          {items.length >= MAX_EXPENSE_ITEMS ? <p className="text-sm text-muted-foreground">{labels.maxItems}</p> : null}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="pb-3" aria-live="polite">
          {summary ? (
            <dl className="flex flex-col gap-1 text-[13px] text-muted-foreground">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <dt>{labels.itemizedTotal}</dt><dd><Amount minor={summary.itemizedMinor} currency={currency} /></dd>
              </div>
              {summary.remainderMinor > 0 ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <dt>{labels.remainder}</dt><dd><Amount minor={summary.remainderMinor} currency={currency} /></dd>
                </div>
              ) : <div><dt className="sr-only">{labels.itemizedTotal}</dt><dd>{labels.fullyItemized}</dd></div>}
            </dl>
          ) : !result.valid && result.reason !== "invalidParent" ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-border bg-accent p-3 text-sm">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {result.reason === "exceedsParent" ? labels.exceedsTotal : labels.invalidItem}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
