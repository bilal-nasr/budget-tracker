import { expect, it } from "vitest";
import { salaryStatusFromReceipt } from "./schema";

it("carries receipt identity independently of its month badge", () => {
  const receipt = { id: "s1", occurredOn: "2026-10-31", createdAt: "2026-11-04T12:00:00Z" };
  expect(salaryStatusFromReceipt(receipt, "Asia/Beirut", new Date("2026-11-04T12:00:00Z")))
    .toEqual({ receiptId: "s1", lastReceivedOn: "2026-10-31", receivedThisMonth: false });
  expect(salaryStatusFromReceipt(null, "Asia/Beirut"))
    .toEqual({ receiptId: null, lastReceivedOn: null, receivedThisMonth: false });
});
