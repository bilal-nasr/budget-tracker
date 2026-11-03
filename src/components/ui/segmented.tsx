"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Single-choice segmented control built on native radios, so keyboard, focus
 * and RTL arrow-key direction come from the browser. Segments are 44px tall.
 */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: React.ReactNode }[];
  className?: string;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "grid gap-1 rounded-xl bg-secondary p-1",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="relative grid min-h-11 cursor-pointer place-items-center rounded-lg px-2 text-[15px] font-medium text-muted-foreground transition-colors has-checked:bg-primary has-checked:font-semibold has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
