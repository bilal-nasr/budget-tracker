import { TileGlyph } from "./tile-glyph";
import { cn } from "@/lib/utils";

/** A 2x2 patch of tile floor for empty states. Decorative. */
export function TileOrnament({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      dir="ltr"
      className={cn("grid size-24 grid-cols-2 gap-1 rounded-lg border border-border bg-card p-1.5", className)}
    >
      <TileGlyph tile={3} className="size-full rounded-sm bg-tile-teal/10 p-1.5 text-tile-teal" />
      <TileGlyph tile={2} className="size-full rounded-sm bg-tile-oxblood/10 p-1.5 text-tile-oxblood" />
      <TileGlyph tile={4} className="size-full rounded-sm bg-tile-ochre/10 p-1.5 text-tile-ochre" />
      <TileGlyph tile={1} className="size-full rounded-sm bg-tile-teal/10 p-1.5 text-tile-teal" />
    </div>
  );
}
