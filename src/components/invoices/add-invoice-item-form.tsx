"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/text-area-field";
import { TextField } from "@/components/ui/text-field";
import { canAddIn, parseQuantity } from "@/features/invoices/display";
import { invoiceErrorKey } from "@/features/invoices/errors";
import { itemCreateSchema, MAX_ITEM_NAME, type InvoiceCategory, type InvoiceItem, type ItemCreateInput } from "@/features/invoices/schema";
import { currencyIntent } from "@/lib/currency-intent";
import { parseAmount } from "@/lib/money";
import type { ActionResult } from "@/lib/supabase/action";
import { CategorySelect, fieldSelectClass } from "./category-select";
import { LineTotal, QuantityField } from "./quantity-field";

export { fieldSelectClass };

/**
 * Quick entry: name, price and one of the viewer's enabled currencies; Enter adds the row at
 * once and the name field is ready for the next one. The chosen currency stays for the next
 * row. If the save fails the text comes back with the reason; a retry reuses the same id only
 * while the text is unchanged and the failure was not a `conflict` (the id is taken, so it
 * would fail again), so an edited retry is never swallowed as a duplicate of the old one.
 * `nameRef` lets the folder screen put focus back here (after a row is deleted). The category
 * is chosen by the folder screen (so a category made in the manager is picked at once) and stays
 * for the next row, like the currency.
 */
export function AddInvoiceItemForm({ folderId, viewerId, categories, categoryId, onCategoryChange, onNewCategory, onAdd, nameRef: outerNameRef }: {
  folderId: string;
  viewerId: string;
  categories: readonly InvoiceCategory[];
  categoryId: string;
  onCategoryChange: (categoryId: string) => void;
  onNewCategory: () => void;
  nameRef?: React.RefObject<HTMLTextAreaElement | null>;
  onAdd: (item: InvoiceItem, input: ItemCreateInput) => Promise<ActionResult>;
}) {
  const t = useTranslations("Invoices");
  const { enabledCurrencies, defaultCurrency } = useAppData();
  const currencies = useMemo(() => [...enabledCurrencies].sort((a, b) => Number(b.code === defaultCurrency) - Number(a.code === defaultCurrency)), [enabledCurrencies, defaultCurrency]);
  const [chosen, setChosen] = useState<string | null>(null);
  const unit = currencies.find((currency) => currency.code === chosen) ?? currencies[0];
  const code = unit?.code ?? "";

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [quantityText, setQuantityText] = useState("1");
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [retry, setRetry] = useState<{ id: string; name: string; text: string; quantityText: string; currency: string; categoryId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownNameRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = outerNameRef ?? ownNameRef;
  const priceRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLSelectElement>(null);
  const currencyId = useId();
  useMoneyDraftUnit(unit, () => setText(""), !!unit);

  const id = retry && retry.name === name && retry.text === text && retry.quantityText === quantityText && retry.currency === code && retry.categoryId === categoryId ? retry.id : fresh;
  const minor = unit ? parseAmount(text, unit) : null;
  const quantity = parseQuantity(quantityText);
  const parsed = itemCreateSchema.safeParse({
    expectedUnits: currencyIntent(unit), id, folderId, categoryId, name, currency: code, decimalPlaces: unit?.decimalPlaces, priceMinor: minor, quantity,
  });
  const valid = !!unit && canAddIn(code, currencies) && parsed.success;

  const submit = () => {
    if (!valid || !parsed.success) return;
    const input = parsed.data;
    const draft = { name, text, quantityText };
    setName(""); setText(""); setQuantityText("1"); setFresh(crypto.randomUUID()); setRetry(null); setError(null);
    nameRef.current?.focus();
    const now = new Date().toISOString();
    const item: InvoiceItem = {
      id: input.id, folderId, categoryId: input.categoryId, name: input.name, currency: input.currency, decimalPlaces: input.decimalPlaces,
      priceMinor: input.priceMinor, quantity: input.quantity, createdBy: viewerId, createdAt: now, updatedAt: now,
    };
    void onAdd(item, input).then((result) => {
      if (result.ok) return;
      setError(t(invoiceErrorKey(result.error)));
      // Put the text back only into empty fields still on the same currency, under the id it was sent with.
      const untouched = !nameRef.current?.value && !priceRef.current?.value && (currencyRef.current?.value ?? input.currency) === input.currency;
      if (!untouched) return;
      setName(draft.name); setText(draft.text); setQuantityText(draft.quantityText);
      // A taken id would fail the same way again, so the next attempt gets the fresh id.
      if (result.error !== "conflict") setRetry({ id: input.id, name: draft.name, text: draft.text, quantityText: draft.quantityText, currency: input.currency, categoryId: input.categoryId });
    });
  };

  if (!currencies.length) return <p className="rounded-xl border border-border bg-card p-3.5 text-[15px] text-muted-foreground">{t("noCurrency")}</p>;

  const many = currencies.length > 1;
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5">
      <TextAreaField ref={nameRef} label={t("itemName")} placeholder={t("itemNamePlaceholder")} value={name} maxLength={MAX_ITEM_NAME}
        onChange={(event) => setName(event.target.value)} autoComplete="off" enterKeyHint="next" onEnter={() => priceRef.current?.focus()} />
      <div className={many ? "grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-2.5" : "flex flex-col"}>
        <TextField ref={priceRef} label={many ? t("price") : t("priceIn", { currency: code })} value={text} onChange={(event) => setText(event.target.value)}
          inputMode={unit.decimalPlaces ? "decimal" : "numeric"} enterKeyHint="done"
          error={text.trim() && minor === null ? t("errorInvalid") : null} />
        {many ? <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={currencyId} className="text-sm font-medium">{t("currency")}</label>
          <select ref={currencyRef} id={currencyId} dir="ltr" value={code} className={fieldSelectClass}
            onChange={(event) => { if (canAddIn(event.target.value, currencies)) setChosen(event.target.value); }}>
            {currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
          </select>
        </div> : null}
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-2.5">
        <QuantityField text={quantityText} onChange={setQuantityText} valid={quantity !== null} />
        <CategorySelect categories={categories} value={categoryId} onChange={onCategoryChange} onNew={onNewCategory} />
      </div>
      <LineTotal unit={unit} priceMinor={minor} quantity={quantity} />
      {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
      <Button type="submit" disabled={!valid}><Plus aria-hidden />{t("addItem")}</Button>
    </form>
  );
}
