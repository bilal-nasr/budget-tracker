"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextAreaField } from "@/components/ui/text-area-field";
import { TextField } from "@/components/ui/text-field";
import { canAddIn, categoryOf, rowDefinition } from "@/features/invoices/display";
import { invoiceErrorKey } from "@/features/invoices/errors";
import { itemEditSchema, MAX_ITEM_NAME, type InvoiceCategory, type InvoiceItem, type ItemEditInput } from "@/features/invoices/schema";
import { indexCurrencies } from "@/lib/currency";
import { parseAmount, toInputText } from "@/lib/money";
import type { ActionResult } from "@/lib/supabase/action";
import { CategorySelect, fieldSelectClass } from "./category-select";

/**
 * Edit any row in the folder, whoever added it. The price keeps the row's own currency and
 * stored decimals, even one the editor never enabled; moving the row to another currency is
 * offered only among the editor's enabled ones. Saving a row someone else removed is handled
 * by the parent (it says so and closes); other failures stay here with the reason.
 */
export function InvoiceItemSheet({ item, categories, onClose, onSave, onDelete }: {
  item: InvoiceItem;
  categories: readonly InvoiceCategory[];
  onClose: () => void;
  onSave: (input: ItemEditInput) => Promise<ActionResult>;
  onDelete: () => void;
}) {
  const t = useTranslations("Invoices");
  const { currencies, enabledCurrencies, defaultCurrency } = useAppData();
  const own = rowDefinition(item, useMemo(() => indexCurrencies(currencies), [currencies]));
  const others = useMemo(() => [...enabledCurrencies]
    .sort((a, b) => Number(b.code === defaultCurrency) - Number(a.code === defaultCurrency))
    .filter((currency) => currency.code !== item.currency), [enabledCurrencies, defaultCurrency, item.currency]);
  const formId = useId();
  const currencyId = useId();
  const [code, setCode] = useState(item.currency);
  const moving = code !== item.currency;
  const unit = moving ? others.find((currency) => currency.code === code) : own;
  const [name, setName] = useState(item.name);
  // A row in a category this screen does not know yet (just made by someone else) shows under "Other".
  const ownCategory = categoryOf(item.categoryId, categories) ?? item.categoryId;
  const [categoryId, setCategoryId] = useState(ownCategory);
  const [text, setText] = useState(() => toInputText(item.priceMinor, own));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useMoneyDraftUnit(unit, () => setText(""), !!unit);

  const minor = unit ? parseAmount(text, unit) : null;
  const parsed = itemEditSchema.safeParse({
    name, priceMinor: minor, ...(categoryId !== ownCategory ? { categoryId } : {}), ...(moving && unit ? { currency: unit.code, decimalPlaces: unit.decimalPlaces } : {}),
  });
  const valid = !!unit && (!moving || canAddIn(code, others)) && parsed.success;

  const submit = () => {
    if (!valid || !parsed.success || pending) return;
    const input = parsed.data;
    setError(null);
    startTransition(async () => {
      const result = await onSave(input);
      if (!result.ok && result.error !== "conflict") setError(t(invoiceErrorKey(result.error)));
    });
  };

  return <SheetShell open title={t("editTitle")} dismissible={!pending} onOpenChange={(open) => !open && onClose()}
    footer={<Button variant="action" size="lg" className="w-full" form={formId} type="submit" loading={pending} disabled={!valid}>{t("saveItem")}</Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-4">
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <TextAreaField label={t("itemName")} value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_ITEM_NAME} autoComplete="off" required />
        <div className={others.length ? "grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-2.5" : "flex flex-col"}>
          <TextField label={others.length ? t("price") : t("priceIn", { currency: item.currency })} value={text} onChange={(event) => setText(event.target.value)}
            inputMode={unit?.decimalPlaces ? "decimal" : "numeric"} error={text.trim() && minor === null ? t("errorInvalid") : null} required />
          {others.length ? <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={currencyId} className="text-sm font-medium">{t("currency")}</label>
            <select id={currencyId} dir="ltr" value={code} className={fieldSelectClass}
              onChange={(event) => { if (event.target.value === item.currency || canAddIn(event.target.value, others)) setCode(event.target.value); }}>
              <option value={item.currency}>{item.currency}</option>
              {others.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
            </select>
          </div> : null}
        </div>
        <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
        <Button type="button" variant="destructive" className="self-start" onClick={onDelete}><Trash2 aria-hidden />{t("deleteItem")}</Button>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
    </form>
  </SheetShell>;
}
