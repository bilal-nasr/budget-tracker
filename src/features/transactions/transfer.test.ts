import { describe, expect, it } from "vitest";
import { classifyBalanceTransfer, transferInputSchema } from "./schema";
const a = { id: "00000000-0000-4000-8000-000000000001", walletId: "a", currency: "USD" };
const b = { id: "00000000-0000-4000-8000-000000000002", walletId: "b", currency: "USD" };
describe("exact balance transfers", () => {
 it("classifies both same and cross currency between wallets as Move", () => {
  expect(classifyBalanceTransfer(a,b)).toBe("move");
  expect(classifyBalanceTransfer(a,{...b,currency:"LBP"})).toBe("move");
 });
 it("classifies currencies inside one wallet as Exchange and rejects the same row", () => {
  expect(classifyBalanceTransfer(a,{...b,walletId:"a",currency:"LBP"})).toBe("exchange");
  expect(() => classifyBalanceTransfer(a,a)).toThrow();
 });
 it("validates exact durable ids, positive actual amounts and real dates", () => {
  const input={requestId:a.id,occurredOn:"2026-11-05",sourceBalanceId:a.id,destinationBalanceId:b.id,sentMinor:123,receivedMinor:456};
  expect(transferInputSchema.safeParse(input).success).toBe(true);
  expect(transferInputSchema.safeParse({...input,destinationBalanceId:a.id}).success).toBe(false);
  expect(transferInputSchema.safeParse({...input,occurredOn:"2026-02-31"}).success).toBe(false);
  expect(transferInputSchema.safeParse({...input,receivedMinor:0}).success).toBe(false);
 });
});
