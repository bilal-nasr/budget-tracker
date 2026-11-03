"use client";

import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";

/**
 * Ask-before-doing sheet: a bottom sheet on phones, centered on desktop, with
 * Cancel and Confirm pinned in the footer. Closing it any other way does nothing.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  pending = false,
  tone = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Disables Confirm while the action runs, so a double tap acts once. */
  pending?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <SheetShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "destructive" : "action"}
            size="lg"
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-[15px]">{children}</div>
    </SheetShell>
  );
}
