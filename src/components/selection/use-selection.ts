"use client";

import { useCallback, useMemo, useState } from "react";

const EMPTY: ReadonlySet<string> = new Set();

export type Selection = {
  /** True while the list is in select mode (rows tick instead of opening). */
  selecting: boolean;
  /** Ticked ids, already limited to rows that still exist and can be ticked. */
  picked: ReadonlySet<string>;
  count: number;
  /** Every tickable row is ticked (false for an empty list). */
  allPicked: boolean;
  isPicked: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Ticks every tickable row, or clears when they are all ticked already. */
  toggleAll: () => void;
  clear: () => void;
  /** Enters select mode, optionally with one row already ticked (long-press). */
  start: (id?: string) => void;
  /** Leaves select mode and forgets the ticks. */
  stop: () => void;
};

/**
 * Select mode for one list. Pass the ids that may be ticked right now (keep the array stable with
 * useMemo); a row that is deleted, filtered out or no longer tickable drops out of `picked` by
 * itself, so a stale tick can never reach a bulk action.
 */
export function useSelection(selectableIds: readonly string[]): Selection {
  const [selecting, setSelecting] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(EMPTY);
  const picked = useMemo(() => {
    if (ticked.size === 0) return ticked;
    const allowed = new Set(selectableIds);
    const live = new Set([...ticked].filter((id) => allowed.has(id)));
    return live.size === ticked.size ? ticked : live;
  }, [ticked, selectableIds]);
  const toggle = useCallback((id: string) => {
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const allPicked = selectableIds.length > 0 && picked.size === selectableIds.length;
  const toggleAll = useCallback(() => {
    setTicked(allPicked ? EMPTY : new Set(selectableIds));
  }, [allPicked, selectableIds]);
  const clear = useCallback(() => setTicked(EMPTY), []);
  const start = useCallback((id?: string) => {
    setSelecting(true);
    setTicked(id === undefined ? EMPTY : new Set([id]));
  }, []);
  const stop = useCallback(() => {
    setSelecting(false);
    setTicked(EMPTY);
  }, []);
  const isPicked = useCallback((id: string) => picked.has(id), [picked]);
  return { selecting, picked, count: picked.size, allPicked, isPicked, toggle, toggleAll, clear, start, stop };
}
