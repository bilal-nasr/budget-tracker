import type { SVGProps } from "react";
import { BusFront, CarFront, PiggyBank, ReceiptText, ShoppingBag, ShoppingBasket, Utensils, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Eight decorative motifs plus seven meaningful category icons. */
export const TILE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const TILE_COUNT = TILE_IDS.length;
export type TileId = (typeof TILE_IDS)[number];
export type TileColor = "teal" | "oxblood" | "ochre";
type MotifId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const PATHS: Record<MotifId, React.ReactNode> = {
  1: <path fillRule="evenodd" d="M12 2 22 12 12 22 2 12Z M12 7 17 12 12 17 7 12Z" />,
  2: (
    <path d="M12 3c3 0 3 6 0 9 3-3 9-3 9 0s-6 3-9 0c3 3 3 9 0 9s-3-6 0-9c-3 3-9 3-9 0s6-3 9 0c-3-3-3-9 0-9Z" />
  ),
  3: <path fillRule="evenodd" d="M3 3h18v18H3Z M6 6v12h12V6Z M9 9h6v6H9Z" />,
  4: (
    <path
      fillRule="evenodd"
      d="M12 1l3 6 6-3-3 6 6 3-6 3 3 6-6-3-3 6-3-6-6 3 3-6-6-3 6-3-3-6 6 3Z M12 8l4 4-4 4-4-4Z"
    />
  ),
  5: <path d="M2 8 12 2l10 6v4L12 6 2 12Z M2 18l10-6 10 6v4l-10-6-10 6Z" />,
  6: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <circle cx="17" cy="7" r="4.5" />
      <circle cx="7" cy="17" r="4.5" />
      <circle cx="17" cy="17" r="4.5" />
    </>
  ),
  7: <path fillRule="evenodd" d="M12 2 20 8v8l-8 6-8-6V8Z M12 8l4 3v3l-4 3-4-3v-3Z" />,
  8: <path d="M2 2h9v9H2Z M13 13h9v9h-9Z M13 2h9v9Z M2 13h9v9Z" />,
};

const CATEGORY_ICONS: Partial<Record<TileId, LucideIcon>> = {
  9: ShoppingBasket,
  10: ReceiptText,
  11: ShoppingBag,
  12: CarFront,
  13: PiggyBank,
  14: BusFront,
  15: Utensils,
};

const COLOR_VAR: Record<TileColor, string> = {
  teal: "var(--tile-teal)",
  oxblood: "var(--tile-oxblood)",
  ochre: "var(--tile-ochre)",
};

export function TileGlyph({
  tile,
  className,
  ...props
}: { tile: TileId } & SVGProps<SVGSVGElement>) {
  const Icon = CATEGORY_ICONS[tile];
  if (Icon) {
    return <Icon aria-hidden="true" strokeWidth={1.8} className={cn("size-8", className)} {...props} />;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-8", className)}
      {...props}
    >
      {PATHS[tile as MotifId]}
    </svg>
  );
}

/** The category chip: an icon on a tinted square. Decorative; the name sits beside it. */
export function CategoryGlyph({
  tile,
  color,
  className,
}: {
  tile: TileId;
  color: TileColor;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-md border",
        className,
      )}
      style={{
        color: COLOR_VAR[color],
        background: `color-mix(in srgb, ${COLOR_VAR[color]} 10%, var(--card))`,
        borderColor: `color-mix(in srgb, ${COLOR_VAR[color]} 28%, var(--card))`,
      }}
    >
      <TileGlyph tile={tile} className="size-[30px]" />
    </span>
  );
}
