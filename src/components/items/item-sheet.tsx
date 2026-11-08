"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useMoneyDraftUnit, useRuntimeBalances } from "@/components/add/runtime-balances";
import { useLoanSubmission } from "@/components/loans/use-loan-submission";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { updateItem } from "@/features/items/actions";
import { itemErrorKey } from "@/features/items/errors";
import { itemEditSchema, MAX_ITEM_NAME, type ItemEditInput, type ShoppingItem } from "@/features/items/schema";
import { currencyIntent } from "@/lib/currency-intent";
import { parseAmount, toInputText } from "@/lib/money";
import { useRouter } from "@/i18n/navigation";

/** Change an item's name or price. Currency is fixed: it decides which wallets can pay for the item. */
export function ItemSheet({ item, onClose, onDelete }: { item: ShoppingItem; onClose: () => void; onDelete: () => void }) {
  const t = useTranslations("Items");
  const router = useRouter();
  const { definition } = useRuntimeBalances();
  const unit = definition(item.currency);
  const formId = useId();
  const [name, setName] = useState(item.name);
  const [text, setText] = useState(toInputText(item.priceMinor, unit));
  const submission = useLoanSubmission<ItemEditInput, object>(
    (input) => updateItem(item.id, input),
    () => { onClose(); toast(t("updated")); },
  );
  useMoneyDraftUnit(unit, () => setText(""), !unit.disabled);
  const minor = parseAmount(text, unit);
  const parsed = itemEditSchema.safeParse({ expectedUnits: currencyIntent(unit), name, priceMinor: minor });
  const valid = !unit.disabled && parsed.success;
  return <SheetShell open title={t("editTitle")} dismissible={submission.dismissible} onOpenChange={(open) => !open && onClose()}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("review")}</Button> :
      <Button variant="action" size="lg" className="w-full" form={formId} type="submit" loading={submission.pending} disabled={!submission.uncertain && !valid}>{t(submission.uncertain ? "retrySame" : "save")}</Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submission.submit(valid && parsed.success ? parsed.data : null); }} className="flex flex-col gap-4">
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <TextField label={t("name")} value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_ITEM_NAME} autoComplete="off" required />
        <TextField label={t("price", { currency: item.currency })} value={text} onChange={(event) => setText(event.target.value)}
          inputMode={unit.decimalPlaces ? "decimal" : "numeric"} error={text.trim() && minor === null ? t("errorInvalid") : null} required />
        <Button type="button" variant="destructive" className="self-start" onClick={onDelete}>{t("delete")}</Button>
      </fieldset>
      {submission.error ? <p role="alert" className="text-sm">{t(submission.uncertain ? "errorUncertain" : itemErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
