"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { GripVertical } from "lucide-react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppData } from "@/components/providers/app-data";
import { reorderWallets } from "@/features/wallets/actions";
import type { WalletContainer } from "@/features/wallets/schema";

function SortableWallet({ wallet, disabled, picked, helpId, onKeyDown, children }: {
  wallet: WalletContainer; disabled: boolean; picked: boolean; helpId: string;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void; children: React.ReactNode;
}) {
  const t = useTranslations("Wallets");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: wallet.id, disabled });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`flex min-w-0 items-stretch border-b border-border bg-card last:border-b-0 ${isDragging ? "relative z-10 shadow-lg" : ""}`}>
    <button {...attributes} {...listeners} ref={setActivatorNodeRef} type="button" aria-label={t("reorderNamed", { name: wallet.name })}
      aria-describedby={helpId} aria-pressed={picked} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onKeyDown={onKeyDown}
      className="grid w-11 shrink-0 touch-none cursor-grab place-items-center text-muted-foreground active:cursor-grabbing aria-disabled:cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <GripVertical aria-hidden className="size-5" />
    </button>
    {children}
  </li>;
}

/** One complete ordinary active order, shared across currencies and selectors. */
export function WalletReorder({ children, showHelp = false }: { children: (wallet: WalletContainer) => React.ReactNode; showHelp?: boolean }) {
  const { walletContainers: wallets, setWalletOrder, walletOrderSource } = useAppData();
  const t = useTranslations("Wallets");
  const nav = useTranslations("Nav");
  const helpId = useId();
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const [keyboardPickup, setKeyboardPickup] = useState<{ id: string; name: string; source: object | undefined } | null>(null);
  const keyboardDragging = keyboardPickup?.source === walletOrderSource ? keyboardPickup?.id ?? null : null;
  const startOrder = useRef<{ ids: string[]; source: object | undefined } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (keyboardPickup && keyboardPickup.source !== walletOrderSource) {
    setKeyboardPickup(null);
    setAnnouncement(t("sortCancelled", { name: keyboardPickup.name }));
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const ids = wallets.map((wallet) => wallet.id);
  const announce = (key: "sortPicked" | "sortMoved" | "sortDropped", id: string, position: number) => {
    const wallet = wallets.find((item) => item.id === id);
    if (wallet) setAnnouncement(t(key, { name: wallet.name, position: position + 1, count: wallets.length }));
  };
  const save = (next: string[], previous: string[]) => {
    if (saving.current || next.join() === previous.join()) return;
    saving.current = true;
    setWalletOrder(next);
    setError(null);
    startTransition(async () => {
      try {
        const result = await reorderWallets(next);
        if (!result.ok) {
          setWalletOrder(previous);
          setError(t(result.error === "notConfigured" ? "errorPreview" : result.error === "reorderConflict" ? "errorReorderConflict" : "errorFailed"));
          return;
        }
        setAnnouncement(t("reordered"));
      } catch {
        setWalletOrder(previous);
        setError(t("errorFailed"));
      } finally { saving.current = false; }
    });
  };
  const onKeyDown = (wallet: WalletContainer, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (pending || saving.current) return;
    const from = ids.indexOf(wallet.id);
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (keyboardDragging === wallet.id) {
        const previous = startOrder.current && startOrder.current.source === walletOrderSource ? startOrder.current.ids : ids;
        startOrder.current = null;
        setKeyboardPickup(null);
        announce("sortDropped", wallet.id, from);
        save(ids, previous);
      } else if (!keyboardDragging) {
        startOrder.current = { ids, source: walletOrderSource };
        setKeyboardPickup({ id: wallet.id, name: wallet.name, source: walletOrderSource });
        announce("sortPicked", wallet.id, from);
      }
      return;
    }
    if (keyboardDragging !== wallet.id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setWalletOrder(startOrder.current && startOrder.current.source === walletOrderSource ? startOrder.current.ids : null);
      startOrder.current = null;
      setKeyboardPickup(null);
      setAnnouncement(t("sortCancelled", { name: wallet.name }));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const to = Math.max(0, Math.min(ids.length - 1, from + (event.key === "ArrowUp" ? -1 : 1)));
      if (from !== to) {
        setWalletOrder(arrayMove(ids, from, to));
        announce("sortMoved", wallet.id, to);
      }
    }
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const snapshot = startOrder.current;
    startOrder.current = null;
    if (!snapshot || snapshot.source !== walletOrderSource) return;
    const previous = snapshot.ids;
    if (!over || active.id === over.id || saving.current) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    announce("sortDropped", String(active.id), to);
    save(arrayMove(ids, from, to), previous);
  };
  return <>
    <p id={helpId} className={showHelp ? "text-sm text-muted-foreground" : "sr-only"}>{t("sortHelp")}</p>
    <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: t("sortHelp") }, announcements: { onDragStart: () => undefined, onDragOver: () => undefined, onDragEnd: () => undefined, onDragCancel: () => undefined } }}
      onDragStart={({ active }) => { startOrder.current = { ids, source: walletOrderSource }; announce("sortPicked", String(active.id), ids.indexOf(String(active.id))); }}
      onDragOver={({ active, over }) => { if (over) announce("sortMoved", String(active.id), ids.indexOf(String(over.id))); }}
      onDragCancel={({ active }) => { startOrder.current = null; const wallet = wallets.find((item) => item.id === active.id); if (wallet) setAnnouncement(t("sortCancelled", { name: wallet.name })); }}
      onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={nav("wallets")} aria-busy={pending} className="overflow-hidden rounded-xl border border-border bg-card">
          {wallets.map((wallet) => <SortableWallet key={wallet.id} wallet={wallet} disabled={pending || (!!keyboardDragging && keyboardDragging !== wallet.id)} picked={keyboardDragging === wallet.id} helpId={helpId} onKeyDown={(event) => onKeyDown(wallet, event)}>{children(wallet)}</SortableWallet>)}
        </ul>
      </SortableContext>
    </DndContext>
    {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
  </>;
}
