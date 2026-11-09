import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import {
  categoryCreateSchema, categoryRenameSchema, folderCreateSchema, folderRenameSchema, itemCreateSchema, itemEditSchema, personNameSchema, tokenSchema,
} from "./schema";

const id = "11111111-1111-4111-8111-111111111111";
const folderId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const item = { id, folderId, categoryId, name: "Cement", currency: "usd", decimalPlaces: 2, priceMinor: 1500 };

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

describe("category schemas", () => {
  it("trims names and holds them to 1..40 characters", () => {
    expect(categoryRenameSchema.parse({ name: "  Case & Cooling " }).name).toBe("Case & Cooling");
    expect(categoryRenameSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(categoryRenameSchema.safeParse({ name: "a".repeat(40) }).success).toBe(true);
    expect(categoryRenameSchema.safeParse({ name: "a".repeat(41) }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ id, folderId, name: "Storage" }).success).toBe(true);
    expect(categoryCreateSchema.safeParse({ id: "nope", folderId, name: "Storage" }).success).toBe(false);
  });
});

describe("itemCreateSchema", () => {
  it("accepts a valid row and upper-cases the currency", () => {
    expect(itemCreateSchema.parse(item).currency).toBe("USD");
  });
  it("keeps a full product title, up to 200 characters", () => {
    const title = "MSI MAG Forge 120A Airflow Mid-Tower (6× Fans, 330mm GPU support)";
    expect(title).toHaveLength(65);
    expect(itemCreateSchema.parse({ ...item, name: title }).name).toBe(title);
    expect(itemCreateSchema.safeParse({ ...item, name: "a".repeat(200) }).success).toBe(true);
  });
  it("rejects 201-character names", () => {
    expect(itemCreateSchema.safeParse({ ...item, name: "a".repeat(201) }).success).toBe(false);
  });
  it("needs a category of the folder", () => {
    expect(itemCreateSchema.safeParse({ ...item, categoryId: undefined }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ ...item, categoryId: "nope" }).success).toBe(false);
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
