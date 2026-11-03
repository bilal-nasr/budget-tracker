import { cn } from "@/lib/utils";

/**
 * Budget progress as a row of tile cells that fill. Progress is also conveyed
 * as text (aria + the caller's visible numbers), and over-budget swaps the last
 * cells to the over tone alongside the caller's icon and "Over" label.
 */
export function TileBar({
  value,
  label,
  cells = 16,
  tone = "card",
  className,
}: {
  /** Spent divided by limit. 1 = exactly at limit, above 1 = over. */
  value: number;
  /** Accessible name, e.g. "Groceries: $340 of $300". */
  label: string;
  cells?: number;
  /** `shell` for use on the teal shell, `card` for white surfaces. */
  tone?: "card" | "shell";
  className?: string;
}) {
  const over = value > 1;
  const filled = Math.min(cells, Math.max(0, Math.round(value * cells)));
  const empty = tone === "shell" ? "var(--shell-cell-empty)" : "var(--cell-empty)";
  const on = tone === "shell" ? "var(--shell-cell-on)" : "var(--cell-on)";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(value * 100))}
      aria-valuetext={`${Math.round(value * 100)}%`}
      dir="ltr"
      className={cn("flex h-3.5 gap-[3px]", className)}
    >
      {Array.from({ length: cells }, (_, index) => {
        const isOn = index < filled;
        const isOver = over && index >= cells - 2;
        return (
          <span
            key={index}
            className="flex-1 rounded-[3px] transition-colors duration-300"
            style={{
              background: isOver ? "var(--over)" : isOn ? on : empty,
            }}
          />
        );
      })}
    </div>
  );
}
