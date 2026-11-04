import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ actionClient: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mock.actionClient }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidatePath }));
import { receiveSalary } from "@/features/salary/actions";
const id = "a1000000-0000-4000-8000-000000000001";
const input = { requestId: id, expectedCycleId: null };
beforeEach(() => {
  vi.clearAllMocks();
  mock.actionClient.mockResolvedValue({ supabase: { rpc: mock.rpc }, userId: "owner" });
  mock.rpc.mockResolvedValue({ data: [{ id, revision: 1 }], error: null });
});
it("delegates salary category choice to the atomic source RPC without client category names", async () => {
  expect(await receiveSalary(input)).toEqual({ ok: true, id, revision: 1 });
  expect(mock.rpc).toHaveBeenCalledWith("receive_salary", { p_request_id: id, p_expected_cycle_id: null });
});
it("preserves category recovery when no active income roots remain", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "salary category not found" } });
  expect(await receiveSalary(input)).toEqual({ ok: false, error: "categoryUnavailable" });
  expect(mock.revalidatePath).not.toHaveBeenCalled();
});
it("does not confuse a failed source query with a genuinely missing category", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "private diagnostics" } });
  expect(await receiveSalary(input)).toEqual({ ok: false, error: "failed" });
  expect(mock.revalidatePath).not.toHaveBeenCalled();
});
