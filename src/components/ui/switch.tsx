"use client";

import { cn } from "@/lib/utils";

/**
 * On/off switch built on a native checkbox (role="switch"), so keyboard, focus
 * and screen readers come from the browser. Wrap it in a <label> to make a whole
 * row the 44px touch target. The knob moves on the logical axis, so it mirrors in RTL.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  className,
  ...aria
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <span className={cn("relative inline-flex h-7 w-12 shrink-0", className)}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
        {...aria}
      />
      <span
        aria-hidden
        className="absolute inset-0 rounded-full border border-input bg-secondary transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 motion-reduce:transition-none"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute start-[3px] top-[3px] size-[22px] rounded-full bg-muted-foreground shadow-sm transition-[inset-inline-start,background-color] duration-150 ease-out peer-checked:start-[23px] peer-checked:bg-primary-foreground peer-disabled:opacity-50 motion-reduce:transition-none"
      />
    </span>
  );
}
