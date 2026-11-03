import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A strip of encaustic tiles laid along the bottom edge of the teal shell.
 * Decorative: it carries no information. Tiles are drawn in the shell's own
 * light tone at low opacity so text above it keeps full contrast.
 */
export function TileBand({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn("block h-4 w-full text-shell-foreground", className)}
    >
      <defs>
        <pattern id={id} width="48" height="16" patternUnits="userSpaceOnUse">
          <g fill="currentColor" opacity="0.16">
            <path fillRule="evenodd" d="M8 1 15 8 8 15 1 8Z M8 5 11 8 8 11 5 8Z" />
            <path d="M32 1c2 0 2 4 0 7 2-3 6-3 6 0s-4 3-6 0c2 3 2 7 0 7s-2-4 0-7c-2 3-6 3-6 0s4-3 6 0c-2-3-2-7 0-7Z" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
