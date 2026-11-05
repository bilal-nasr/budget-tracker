// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TileGlyph, type TileId } from "./tile-glyph";

afterEach(cleanup);

it.each([
  [9, "shopping-basket"],
  [10, "receipt-text"],
  [11, "shopping-bag"],
  [12, "car-front"],
  [13, "piggy-bank"],
  [14, "bus-front"],
  [15, "utensils"],
] as const)("renders semantic tile %s as the %s icon", (tile, icon) => {
  const { container } = render(<TileGlyph tile={tile as TileId} />);
  expect(container.querySelector(`.lucide-${icon}`)).toBeTruthy();
});
