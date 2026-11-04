import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ actionClient: vi.fn(), from: vi.fn(), rpc: vi.fn(), getProfile: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mock.actionClient }));
vi.mock("@/features/profile/queries", () => ({ getProfile: mock.getProfile }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidatePath }));
import { receiveSalary } from "@/features/salary/actions";
import { payFixedExpense } from "@/features/fixed/actions";
import { payInstallment } from "@/features/installments/actions";
const id = "00000000-0000-4000-8000-000000000001";
let written: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.clearAllMocks();
  const item = { id, name: "Synthetic source", category_id: id, wallet_id: id, amount_minor: 5000 };
  const catalogue = Object.fromEntries(["select", "eq", "is", "order", "limit"].map((name) => [name, vi.fn().mockReturnThis()]));
  catalogue.maybeSingle = vi.fn().mockResolvedValue({ data: item, error: null });
  written = Object.fromEntries(["insert", "select"].map((name) => [name, vi.fn().mockReturnThis()]));
  written.single = vi.fn().mockResolvedValue({ data: { id, revision: 7 }, error: null });
  mock.from.mockImplementation((table) => table === "transactions" ? written : catalogue);
  mock.actionClient.mockResolvedValue({ supabase: { from: mock.from, rpc: mock.rpc }, userId: id });
  mock.rpc.mockResolvedValue({ data: [{ id, revision: 7 }], error: null });
  mock.getProfile.mockResolvedValue({ timezone: "Asia/Beirut", salary: { walletId: id, amountMinor: 5000 } });
});
describe.each([
  ["salary", () => receiveSalary({ requestId: id, expectedCycleId: null })],
  ["fixed", () => payFixedExpense(id)],
  ["installment", () => payInstallment({ requestId: id, salaryCycleId: null, overrideOfTransactionId: null, installmentId: id, walletId: id, amountMinor: 5000, occurredOn: "2026-11-04" })],
] as const)("%s source creation revision", (source, invoke) => {
  it("returns the selected revision in the same insert response and preserves source metadata", async () => {
    expect(await invoke()).toEqual({ ok: true, id, revision: 7 });
    if (source === "fixed") {
      expect(written.select).toHaveBeenCalledExactlyOnceWith("id, revision");
      expect(written.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source }));
    } else {
      expect(mock.rpc).toHaveBeenCalledExactlyOnceWith(source === "salary" ? "receive_salary" : "record_installment_payment",
        expect.objectContaining({ p_request_id: id }));
      expect(written.insert).not.toHaveBeenCalled();
    }
    expect(mock.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });
  it("cannot report a successful creation without a usable Undo token", async () => {
    written.single.mockResolvedValue({ data: { id }, error: null });
    mock.rpc.mockResolvedValue({ data: [{ id }], error: null });
    expect(await invoke()).toEqual({ ok: false, error: "failed" });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });
});
