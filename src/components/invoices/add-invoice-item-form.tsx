"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { canAddIn } from "@/features/invoices/display";
import { invoiceErrorKey } from "@/features/invoices/errors";
import { itemCreateSchema, MAX_NAME, type InvoiceItem, type ItemCreateInput } from "@/features/invoices/schema";
import { currencyIntent } from "@/lib/currency-intent";
import { parseAmount } from "@/lib/money";
import type { ActionResult } from "@/lib/supabase/action";

export const fieldSelectClass = "h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Quick entry: name, price and one of the viewer's enabled currencies; Enter adds the row at
 * once and the name field is ready for the next one. The chosen currency stays for the next
 * row. If the save fails the text comes back with the reason; a retry reuses the same id only
 * while the text is unchanged and the failure was not a `conflict` (the id is taken, so it
 * would fail again), so an edited retry is never swallowed as a duplicate of the old one.
 * `nameRef` lets the folder screen put focus back here (after a row is deleted).
 */
export function AddInvoiceItemForm({ folderId, viewerId, onAdd, nameRef: outerNameRef }: {
  folderId: string;
  viewerId: string;
  nameRef?: React.RefObject<HTMLInputElement | null>;
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
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [retry, setRetry] = useState<{ id: string; name: string; text: string; currency: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownNameRef = useRef<HTMLInputElement>(null);
  const nameRef = outerNameRef ?? ownNameRef;
  const priceRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLSelectElement>(null);
  const currencyId = useId();
  useMoneyDraftUnit(unit, () => setText(""), !!unit);

  const id = retry && retry.name === name && retry.text === text && retry.currency === code ? retry.id : fresh;
  const minor = unit ? parseAmount(text, unit) : null;
  const parsed = itemCreateSchema.safeParse({
    expectedUnits: currencyIntent(unit), id, folderId, name, currency: code, decimalPlaces: unit?.decimalPlaces, priceMinor: minor,
  });
  const valid = !!unit && canAddIn(code, currencies) && parsed.success;

  const submit = () => {
    if (!valid || !parsed.success) return;
    const input = parsed.data;
    const draft = { name, text };
    setName(""); setText(""); setFresh(crypto.randomUUID()); setRetry(null); setError(null);
    nameRef.current?.focus();
    const now = new Date().toISOString();
    const item: InvoiceItem = {
      id: input.id, folderId, name: input.name, currency: input.currency, decimalPlaces: input.decimalPlaces,
      priceMinor: input.priceMinor, createdBy: viewerId, createdAt: now, updatedAt: now,
    };
    void onAdd(item, input).then((result) => {
      if (result.ok) return;
      setError(t(invoiceErrorKey(result.error)));
      // Put the text back only into empty fields still on the same currency, under the id it was sent with.
      const untouched = !nameRef.current?.value && !priceRef.current?.value && (currencyRef.current?.value ?? input.currency) === input.currency;
      if (!untouched) return;
      setName(draft.name); setText(draft.text);
      // A taken id would fail the same way again, so the next attempt gets the fresh id.
      if (result.error !== "conflict") setRetry({ id: input.id, name: draft.name, text: draft.text, currency: input.currency });
    });
  };

  if (!currencies.length) return <p className="rounded-xl border border-border bg-card p-3.5 text-[15px] text-muted-foreground">{t("noCurrency")}</p>;

  const many = currencies.length > 1;
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5">
      <TextField ref={nameRef} label={t("itemName")} placeholder={t("itemNamePlaceholder")} value={name} maxLength={MAX_NAME}
        onChange={(event) => setName(event.target.value)} autoComplete="off" enterKeyHint="next" />
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
      {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
      <Button type="submit" disabled={!valid}><Plus aria-hidden />{t("addItem")}</Button>
    </form>
  );
}
