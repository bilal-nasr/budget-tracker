"use client";

import { X } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

/**
 * Bottom sheet frame: title and close on top, a scrolling body, and a footer
 * pinned above the keyboard and the safe area. Centered and narrow on desktop.
 */
export function SheetShell({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  dismissible?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("Nav");
  const titleId = useId();
  const descriptionId = useId();
  return (
    <Drawer open={open} onOpenChange={(next) => { if (next || dismissible) onOpenChange(next); }}>
      <DrawerContent aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} className="rounded-t-3xl bg-card md:mx-auto md:max-w-[480px]">
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <DrawerHeader className="px-0 text-start">
            <div className="flex min-h-11 items-center justify-between">
              <DrawerTitle id={titleId} className="text-[17px] font-semibold">{title}</DrawerTitle>
              <DrawerClose render={<Button variant="ghost" size="icon" aria-label={t("close")} disabled={!dismissible} />}>
                <X aria-hidden />
              </DrawerClose>
            </div>
            {description ? (
              <DrawerDescription id={descriptionId} className="text-[15px]">{description}</DrawerDescription>
            ) : null}
          </DrawerHeader>
          <div className="pb-4">{children}</div>
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-border bg-card px-4 pt-2.5 pb-[calc(0.75rem+var(--safe-bottom))]">
            {footer}
          </div>
        ) : (
          <div className="pb-[var(--safe-bottom)]" />
        )}
      </DrawerContent>
    </Drawer>
  );
}
