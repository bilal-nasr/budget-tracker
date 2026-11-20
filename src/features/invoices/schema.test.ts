import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import {
  categoryCreateSchema, categoryRenameSchema, folderCreateSchema, folderRenameSchema, itemCreateSchema, itemEditSchema, personNameSchema, tokenSchema,
  itemsDeleteSchema, itemsMoveSchema, itemsPaySchema, itemsRestoreSchema, MAX_ITEMS, MAX_PAY_CURRENCIES, MAX_PAY_ITEMS,
} from "./schema";

const id = "11111111-1111-4111-8111-111111111111";
const folderId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const item = { id, folderId, categoryId, name: "Cement", currency: "usd", decimalPlaces: 2, priceMinor: 1500, quantity: 1 };

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
  it("takes a whole quantity from 1 to 9999", () => {
    expect(itemCreateSchema.safeParse({ ...item, quantity: 9999 }).success).toBe(true);
    for (const quantity of [0, -1, 1.5, 10_000, undefined, "2"]) {
      expect(itemCreateSchema.safeParse({ ...item, quantity }).success).toBe(false);
    }
  });
  it("keeps price x quantity inside the money range", () => {
    expect(itemCreateSchema.safeParse({ ...item, priceMinor: MAX_MINOR / 10, quantity: 10 }).success).toBe(true);
    expect(itemCreateSchema.safeParse({ ...item, priceMinor: MAX_MINOR / 10, quantity: 11 }).success).toBe(false);
    expect(itemEditSchema.safeParse({ name: "Cement", priceMinor: MAX_MINOR, quantity: 2 }).success).toBe(false);
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
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5, quantity: 1 }).success).toBe(true);
  });
  it("allows currency and decimals together", () => {
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5, quantity: 1, currency: "LBP", decimalPlaces: 0 }).success).toBe(true);
  });
  it("rejects currency without decimalPlaces and the reverse", () => {
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5, quantity: 1, currency: "LBP" }).success).toBe(false);
    expect(itemEditSchema.safeParse({ name: "Sand", priceMinor: 5, quantity: 1, decimalPlaces: 0 }).success).toBe(false);
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

const uuid = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

describe("bulk schemas", () => {
  it("accept one to 500 distinct rows of a folder", () => {
    expect(itemsDeleteSchema.safeParse({ folderId, itemIds: [id] }).success).toBe(true);
    expect(itemsDeleteSchema.safeParse({ folderId, itemIds: Array.from({ length: MAX_ITEMS }, (_, n) => uuid(n)) }).success).toBe(true);
    expect(itemsMoveSchema.safeParse({ folderId, itemIds: [id, uuid(1)], categoryId }).success).toBe(true);
    expect(itemsRestoreSchema.safeParse({ itemIds: [id] }).success).toBe(true);
  });
  it("reject an empty batch, a repeated row, too many rows and missing ids", () => {
    expect(itemsDeleteSchema.safeParse({ folderId, itemIds: [] }).success).toBe(false);
    expect(itemsDeleteSchema.safeParse({ folderId, itemIds: [id, id] }).success).toBe(false);
    expect(itemsDeleteSchema.safeParse({ folderId, itemIds: Array.from({ length: MAX_ITEMS + 1 }, (_, n) => uuid(n)) }).success).toBe(false);
    expect(itemsDeleteSchema.safeParse({ folderId: "x", itemIds: [id] }).success).toBe(false);
    expect(itemsMoveSchema.safeParse({ folderId, itemIds: [id] }).success).toBe(false);
    expect(itemsMoveSchema.safeParse({ folderId, itemIds: ["x"], categoryId }).success).toBe(false);
    expect(itemsRestoreSchema.safeParse({ itemIds: [] }).success).toBe(false);
  });
});

describe("itemsPaySchema", () => {
  const pay = { expectedUnits: { USD: 2 }, folderId, categoryId, occurredOn: "2026-11-06", payments: [{ requestId: uuid(90), balanceId: uuid(91), itemIds: [id] }] };
  it("accepts one payment per currency, each with its own request and balance", () => {
    expect(itemsPaySchema.safeParse(pay).success).toBe(true);
    expect(itemsPaySchema.safeParse({ ...pay, expectedUnits: { USD: 2, LBP: 0 }, payments: [...pay.payments, { requestId: uuid(92), balanceId: uuid(93), itemIds: [uuid(1)] }] }).success).toBe(true);
  });
  it("needs the currencies' decimals, a real date and at least one payment", () => {
    expect(itemsPaySchema.safeParse({ ...pay, expectedUnits: undefined }).success).toBe(false);
    expect(itemsPaySchema.safeParse({ ...pay, occurredOn: "1999-12-31" }).success).toBe(false);
    expect(itemsPaySchema.safeParse({ ...pay, occurredOn: "soon" }).success).toBe(false);
    expect(itemsPaySchema.safeParse({ ...pay, payments: [] }).success).toBe(false);
    expect(itemsPaySchema.safeParse({ ...pay, payments: [{ ...pay.payments[0], itemIds: [] }] }).success).toBe(false);
  });
  it("refuses a row or a request that appears twice, across payments too", () => {
    expect(itemsPaySchema.safeParse({ ...pay, payments: [{ ...pay.payments[0], itemIds: [id, id] }] }).success).toBe(false);
    expect(itemsPaySchema.safeParse({ ...pay, payments: [...pay.payments, { requestId: uuid(92), balanceId: uuid(93), itemIds: [id] }] }).success).toBe(false);
    expect(itemsPaySchema.safeParse({ ...pay, payments: [...pay.payments, { requestId: uuid(90), balanceId: uuid(93), itemIds: [uuid(1)] }] }).success).toBe(false);
  });
  it("caps the rows of one expense and the number of currencies", () => {
    const rows = (count: number, from = 0) => Array.from({ length: count }, (_, n) => uuid(from + n));
    expect(itemsPaySchema.safeParse({ ...pay, payments: [{ ...pay.payments[0], itemIds: rows(MAX_PAY_ITEMS) }] }).success).toBe(true);
    expect(itemsPaySchema.safeParse({ ...pay, payments: [{ ...pay.payments[0], itemIds: rows(MAX_PAY_ITEMS + 1) }] }).success).toBe(false);
    const payments = Array.from({ length: MAX_PAY_CURRENCIES + 1 }, (_, n) => ({ requestId: uuid(1000 + n), balanceId: uuid(2000 + n), itemIds: [uuid(3000 + n)] }));
    expect(itemsPaySchema.safeParse({ ...pay, payments }).success).toBe(false);
    expect(itemsPaySchema.safeParse({ ...pay, payments: payments.slice(1) }).success).toBe(true);
  });
});
