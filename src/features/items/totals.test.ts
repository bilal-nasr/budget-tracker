import { expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { lineMinor, purchaseLabel, totalOf } from "./totals";

it("an item's total is its price times its quantity", () => {
  expect(lineMinor({ priceMinor: 350, quantity: 1 })).toBe(350);
  expect(lineMinor({ priceMinor: 350, quantity: 3 })).toBe(1050);
  expect(lineMinor({ priceMinor: 100_000_000_000_000, quantity: 10 })).toBe(MAX_MINOR);
});

it("totals sum the item totals and report an out-of-range sum as null", () => {
  expect(totalOf([])).toBe(0);
  expect(totalOf([{ priceMinor: 350, quantity: 3 }, { priceMinor: 150, quantity: 1 }])).toBe(1200);
  expect(totalOf([{ priceMinor: MAX_MINOR, quantity: 1 }, { priceMinor: 1, quantity: 1 }])).toBeNull();
  expect(totalOf([{ priceMinor: MAX_MINOR, quantity: 9999 }])).toBeNull();
});

it("names the quantity only when there is more than one", () => {
  expect(purchaseLabel({ name: "Milk", quantity: 1 })).toBe("Milk");
  expect(purchaseLabel({ name: "Milk", quantity: 3 })).toBe("Milk × 3");
});
