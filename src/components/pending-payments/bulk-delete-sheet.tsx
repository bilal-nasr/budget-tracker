"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { deletePendingPayments } from "@/features/pending-payments/bulk-actions";

/** Confirms, then deletes every ticked unpaid job in one request: all of them or none. */
export function BulkDeleteSheet({ items, onClose, onDeleted }: {
  items: { id: string; revision: number }[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("PendingPayments");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remove = () => {
    if (pending || items.length === 0) return;
    startTransition(async () => {
      try {
        const result = await deletePendingPayments(items);
        if (!result.ok) {
          setError(t(result.error === "notConfigured" ? "errorPreview" : result.error === "conflict" ? "bulkConflict" : result.error === "inUse" ? "errorInUse" : "bulkFailed"));
          return;
        }
        toast(t("bulkDeleted", { count: items.length }));
        onDeleted();
      } catch { setError(t("bulkFailed")); }
    });
  };
  return (
    <ConfirmSheet open title={t("bulkDeleteTitle", { count: items.length })} onOpenChange={(open) => { if (!open && !pending) onClose(); }}
      confirmLabel={t("bulkDelete")} cancelLabel={t("cancel")} pending={pending} tone="danger" onConfirm={remove}>
      <p>{t("bulkDeleteBody")}</p>
      {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
    </ConfirmSheet>
  );
}
