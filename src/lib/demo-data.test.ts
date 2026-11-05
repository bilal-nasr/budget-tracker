import { requireCurrency, SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { demoPage } from "./demo-data";
import { toInputText } from "./money";
import { todayIn } from "@/features/transactions/group";

describe("synthetic transaction composition", () => {
  it("keeps every itemized demo expense within its own parent cost", () => {
    const rows = demoPage({}, null, 200).rows;
    const itemized = rows.filter((row) => row.items.length > 0);
    expect(itemized.length).toBeGreaterThan(0);
    for (const parent of itemized) {
      expect(parent.kind).toBe("expense");
      const total = parent.items.reduce((sum, item) => {
        expect(Number.isSafeInteger(item.amountMinor) && item.amountMinor > 0).toBe(true);
        return sum + BigInt(item.amountMinor);
      }, 0n);
      expect(total <= BigInt(parent.amountMinor), parent.note ?? parent.id).toBe(true);
    }
  });

  it("binds the USD breakdown to its named fixture when other-currency seeds are prepended", () => {
    const rows = demoPage({}, null, 200).rows;
    const supermarket = rows.find((row) => row.note === "Supermarket" && row.occurredOn === todayIn("Asia/Beirut"));
    expect(supermarket).toBeDefined();
    expect(supermarket!.currency).toBe("USD");
    expect(supermarket!.items.map((item) => toInputText(item.amountMinor, requireCurrency(supermarket!.currency, SEED_CURRENCY_DEFINITIONS)))).toEqual(["20", "30"]);
    expect(supermarket!.amountMinor).toBe(5420);
    const syp = rows.find((row) => row.note === "Synthetic SYP groceries");
    expect(syp).toBeDefined();
    expect(syp!.currency).toBe("SYP");
    expect(toInputText(syp!.amountMinor, requireCurrency(syp!.currency, SEED_CURRENCY_DEFINITIONS))).toBe("1250");
    expect(syp!.items).toEqual([]);
  });
});
