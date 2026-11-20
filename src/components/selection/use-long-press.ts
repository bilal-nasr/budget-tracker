"use client";

import { useEffect, useMemo, useRef } from "react";

type Handlers = {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
};

/**
 * Press-and-hold on a row of a list, as a shortcut into select mode. Spread the handlers on the
 * list element (`<ul>`); `onLongPress` gets the index of the held row among the list's children.
 * It is only ever a shortcut: the screen must also offer a visible Select button. Scrolling or
 * moving the finger cancels the hold, and the tap that ends a hold is swallowed so the row does
 * not also open or untick. Keep the handlers attached after select mode starts (ignore the
 * callback there instead of removing them), or that swallowing is lost.
 */
export function useLongPress(onLongPress: (index: number) => void, delay = 500): Handlers {
  const callback = useRef(onLongPress);
  useEffect(() => { callback.current = onLongPress; });
  const state = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  useEffect(() => {
    const current = state.current;
    return () => { if (current.timer) clearTimeout(current.timer); };
  }, []);
  return useMemo(() => {
    const cancel = () => {
      if (state.current.timer) clearTimeout(state.current.timer);
      state.current.timer = null;
    };
    return {
      onPointerDown(event) {
        cancel();
        state.current.fired = false;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const list = event.currentTarget;
        const row = Array.from(list.children).findIndex((child) => child.contains(event.target as Node));
        if (row < 0) return;
        state.current.x = event.clientX;
        state.current.y = event.clientY;
        state.current.timer = setTimeout(() => {
          state.current.timer = null;
          state.current.fired = true;
          callback.current(row);
        }, delay);
      },
      onPointerMove(event) {
        if (state.current.timer && Math.hypot(event.clientX - state.current.x, event.clientY - state.current.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onClickCapture(event) {
        if (!state.current.fired) return;
        state.current.fired = false;
        event.preventDefault();
        event.stopPropagation();
      },
      onContextMenu(event) {
        // A touch hold also asks for the browser's context menu; the hold already did its job.
        if (state.current.fired) event.preventDefault();
      },
    };
  }, [delay]);
}
