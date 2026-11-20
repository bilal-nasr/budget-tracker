"use client";

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMoneyDraftUnit, useRuntimeBalances } from "@/components/add/runtime-balances";
import { LineTotal, QuantityField } from "@/components/invoices/quantity-field";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { parseQuantity } from "@/features/invoices/display";
import { itemErrorKey } from "@/features/items/errors";
import { itemCreateSchema, MAX_ITEM_NAME, type ItemCreateInput, type ShoppingItem } from "@/features/items/schema";
import { currencyIntent } from "@/lib/currency-intent";
import { parseAmount } from "@/lib/money";
import type { ActionResult } from "@/lib/supabase/action";

/**
 * Quick entry: type a name and a price (and how many, when it is more than one), press Enter,
 * and the field is ready for the next item. The price is for one unit. The row appears at once (the parent adds it optimistically); if the save fails the
 * text comes back with the reason, under the same id so a retry can never save it twice.
 */
export function AddItemForm({ currency, onAdd }: {
  currency: string;
  onAdd: (item: ShoppingItem, input: ItemCreateInput) => Promise<ActionResult>;
}) {
  const t = useTranslations("Items");
  const { currencyByCode } = useRuntimeBalances();
  const unit = currencyByCode(currency);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [quantityText, setQuantityText] = useState("1");
  const [id, setId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  useMoneyDraftUnit(unit, () => setText(""), !!unit && !unit.disabled);
  const minor = unit ? parseAmount(text, unit) : null;
  const quantity = parseQuantity(quantityText);
  const parsed = itemCreateSchema.safeParse({ expectedUnits: currencyIntent(unit), id, name, currency, priceMinor: minor, quantity });
  const valid = !!unit && !unit.disabled && parsed.success;

  const submit = () => {
    if (!valid || !parsed.success) return;
    const input = parsed.data;
    const draft = { name, text, quantityText };
    setName(""); setText(""); setQuantityText("1"); setId(crypto.randomUUID()); setError(null);
    nameRef.current?.focus();
    startTransition(async () => {
      const item: ShoppingItem = { id: input.id, name: input.name, currency: input.currency, priceMinor: input.priceMinor, quantity: input.quantity, createdAt: new Date().toISOString(), boughtOn: null, transactionId: null };
      const result = await onAdd(item, input).catch((): ActionResult => ({ ok: false, error: "failed" }));
      if (!result.ok) {
        setName((current) => current || draft.name);
        setText((current) => current || draft.text);
        setQuantityText((current) => (current === "1" ? draft.quantityText : current));
        setId(input.id);
        setError(t(itemErrorKey(result.error)));
      }
    });
  };

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5">
      <TextField ref={nameRef} label={t("name")} placeholder={t("namePlaceholder")} value={name} maxLength={MAX_ITEM_NAME}
        onChange={(event) => setName(event.target.value)} autoComplete="off" enterKeyHint="next" />
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-2.5">
        <TextField label={t("price", { currency })} value={text} onChange={(event) => setText(event.target.value)}
          inputMode={unit?.decimalPlaces ? "decimal" : "numeric"} enterKeyHint="done" disabled={!unit}
          error={text.trim() && minor === null ? t("errorPrice") : null} />
        <QuantityField text={quantityText} onChange={setQuantityText} valid={quantity !== null} />
      </div>
      <LineTotal unit={unit} priceMinor={minor} quantity={quantity} />
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
      <Button type="submit" disabled={!valid}><Plus aria-hidden />{t("addItem")}</Button>
    </form>
  );
}
