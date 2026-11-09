import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import {
  folderCreateSchema, folderRenameSchema, itemCreateSchema, itemEditSchema, personNameSchema, tokenSchema,
} from "./schema";

const id = "11111111-1111-4111-8111-111111111111";
const folderId = "22222222-2222-4222-8222-222222222222";
const item = { id, folderId, name: "Cement", currency: "usd", decimalPlaces: 2, priceMinor: 1500 };

describe("folder schemas", () => {
  it("accepts a trimmed name and rejects empty or 61-character names", () => {
    expect(folderRenameSchema.parse({ name: "  Site  " }).name).toBe("Site");
    expect(folderRenameSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(folderRenameSchema.safeParse({ name: "a".repeat(60) }).success).toBe(true);
    expect(folderRenameSchema.safeParse({ name: "a".repeat(61) }).success).toBe(false);
    expect(folderCreateSchema.safeParse({ id, name: "a".repeat(61) }).success).toBe(false);
    expect(folderCreateSchema.safeParse({ id: "nope", name: "ok" }).success).toBe(false);
  });
});

describe("itemCreateSchema", () => {
  it("accepts a valid row and upper-cases the currency", () => {
    expect(itemCreateSchema.parse(item).currency).toBe("USD");
  });
  it("rejects 61-character names", () => {
    expect(itemCreateSchema.safeParse({ ...item, name: "a".repeat(61) }).success).toBe(false);
  });
  it("rejects prices of 0 and above MAX_MINOR", () => {
    expect(itemCreateSchema.safeParse({ ...item, priceMinor: 0 }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ ...item, priceMinor: MAX_MINOR }).success).toBe(true);
    expect(itemCreateSchema.safeParse({ ...item, priceMinor: MAX_MINOR + 1 }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ ...item, priceMinor: 1.5 }).success).toBe(false);
  });
  it("limits decimal places to 0..8", () => {
    expect(itemCreateSchema.safeParse({ ...item, decimalPlaces: 9 }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ ...item, decimalPlaces: -1 }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ ...item, decimalPlaces: 8 }).success).toBe(true);
    expect(itemCreateSchema.safeParse({ ...item, decimalPlaces: 0 }).success).toBe(true);
  });
});

describe("itemEditSchema", () => {
  it("allows a name and price change alone", () => {
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5 }).success).toBe(true);
  });
  it("allows currency and decimals together", () => {
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5, currency: "LBP", decimalPlaces: 0 }).success).toBe(true);
  });
  it("rejects currency without decimalPlaces and the reverse", () => {
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5, currency: "LBP" }).success).toBe(false);
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5, decimalPlaces: 0 }).success).toBe(false);
  });
});

describe("personNameSchema", () => {
  it("trims and bounds to 1..30", () => {
    expect(personNameSchema.parse("  Sam ")).toBe("Sam");
    expect(personNameSchema.safeParse("  ").success).toBe(false);
    expect(personNameSchema.safeParse("a".repeat(30)).success).toBe(true);
    expect(personNameSchema.safeParse("a".repeat(31)).success).toBe(false);
  });
});

describe("tokenSchema", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(tokenSchema.safeParse("a1".repeat(32)).success).toBe(true);
    expect(tokenSchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(tokenSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(tokenSchema.safeParse("A".repeat(64)).success).toBe(false);
    expect(tokenSchema.safeParse("g".repeat(64)).success).toBe(false);
  });
});
