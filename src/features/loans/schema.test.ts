import { describe, expect, it } from "vitest";
import { isLoanDate, loanCreateSchema, loanPaymentSchema } from "./schema";

const input = {
  requestId: "aaaaaaaa-0000-4000-8000-000000000001", name: "  Friend  ", direction: "borrowed",
  principalMinor: 100000, feeBps: 725, walletId: "aaaaaaaa-0000-4000-8000-000000000002",
  feeCategoryId: "aaaaaaaa-0000-4000-8000-000000000003", openedOn: "2026-11-04",
  creationMode: "new", principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0,
};
describe("loan terms", () => {
  it("requires an explicit creation mode and trims the label", () => {
    expect(loanCreateSchema.parse(input).name).toBe("Friend");
    expect(loanCreateSchema.safeParse({ ...input, creationMode: undefined }).success).toBe(false);
  });
  it("rejects fake calendar dates rather than normalizing them", () => {
    expect(isLoanDate("2024-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-02-31", "2026-13-01", "1999-12-31", "x"]) expect(isLoanDate(date)).toBe(false);
    expect(loanCreateSchema.safeParse({ ...input, openedOn: "2026-02-31" }).success).toBe(false);
  });
  it("permits paid-before balances only for an existing loan and caps each component", () => {
    expect(loanCreateSchema.safeParse({ ...input, principalPaidBeforeMinor: 1 }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ ...input, creationMode: "existing", principalPaidBeforeMinor: 40000, feePaidBeforeMinor: 100 }).success).toBe(true);
    expect(loanCreateSchema.safeParse({ ...input, creationMode: "existing", principalPaidBeforeMinor: 100001 }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ ...input, creationMode: "existing", feePaidBeforeMinor: 7251 }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ ...input, userId: "forged" }).success).toBe(false);
  });
  it("rejects noninteger money and future payload fields", () => {
    expect(loanPaymentSchema.safeParse({ requestId: input.requestId, loanId: input.requestId, walletId: input.walletId, amountMinor: 0.1, occurredOn: input.openedOn }).success).toBe(false);
  });
});
