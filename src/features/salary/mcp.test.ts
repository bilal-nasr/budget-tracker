import { beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSalaryStatus = vi.fn();
const getProfile = vi.fn();
vi.mock("./queries", () => ({ getSalaryStatus: (...args: unknown[]) => getSalaryStatus(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
const getWallets = vi.fn();
const getCurrencies = vi.fn();
const saveSalary = vi.fn();
const clearSalary = vi.fn();
const receiveSalary = vi.fn();
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
vi.mock("./actions", () => ({
  saveSalary: (...args: unknown[]) => saveSalary(...args),
  clearSalary: (...args: unknown[]) => clearSalary(...args),
  receiveSalary: (...args: unknown[]) => receiveSalary(...args),
}));
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { salaryTools } from "./mcp";

const tool = (name: string) => salaryTools.find((t) => t.name === name)!;
const BAL = "33333333-3333-4333-8333-333333333333";
const LBP_BAL = "44444444-4444-4444-8444-444444444444";
const REQ = "66666666-6666-4666-8666-666666666666";
const RECEIPT = "77777777-7777-4777-8777-777777777777";
const wallets = [{
  id: "w1", name: "Bank", kind: "bank", position: 0, deleted: false, needsAttention: false, defaultBalanceId: BAL,
  balances: [
    { id: BAL, walletId: "w1", currency: "USD", openingBalanceMinor: 0, balanceMinor: 150000, position: 0, detached: false },
    { id: LBP_BAL, walletId: "w1", currency: "LBP", openingBalanceMinor: 0, balanceMinor: 0, position: 1, detached: false },
  ],
}];
const profile = (salary: { amountMinor: number; balanceId: string } | null) => ({ timezone: "Asia/Beirut", locale: "en", salary });

beforeEach(() => {
  vi.resetAllMocks();
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
  getWallets.mockResolvedValue(wallets);
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("salary_status_get passes the profile timezone and returns the status", async () => {
  const status = { receiptId: "r1", lastReceivedOn: "2026-11-01", receivedThisMonth: true };
  getSalaryStatus.mockResolvedValue(status);
  const [tool] = salaryTools;
  expect(tool.name).toBe("salary_status_get");
  expect(tool.kind).toBe("read");
  await expect(tool.run({})).resolves.toEqual(status);
  expect(getSalaryStatus).toHaveBeenCalledWith("Asia/Beirut");
});

// ---- write tools ----

test("write tools come after the read tool and are writes", () => {
  expect(salaryTools[0].name).toBe("salary_status_get");
  expect(tool("salary_update").kind).toBe("write");
  expect(tool("salary_mark_received").kind).toBe("write");
});

test("salary_update saves amount and balance with the balance's currency intent and returns the profile", async () => {
  getProfile.mockResolvedValueOnce(profile(null)).mockResolvedValue(profile({ amountMinor: 150000, balanceId: BAL }));
  saveSalary.mockResolvedValue({ ok: true });
  const out = await tool("salary_update").run({ amountMinor: 150000, balanceId: BAL });
  expect(saveSalary).toHaveBeenCalledWith({ expectedUnits: { USD: 2 }, amountMinor: 150000, balanceId: BAL });
  expect(out).toEqual(profile({ amountMinor: 150000, balanceId: BAL }));
});

test("salary_update keeps the saved value of a field left out", async () => {
  getProfile.mockResolvedValue(profile({ amountMinor: 150000, balanceId: BAL }));
  saveSalary.mockResolvedValue({ ok: true });
  await tool("salary_update").run({ balanceId: LBP_BAL });
  expect(saveSalary).toHaveBeenLastCalledWith({ expectedUnits: { LBP: 0 }, amountMinor: 150000, balanceId: LBP_BAL });
  await tool("salary_update").run({ amountMinor: 9 });
  expect(saveSalary).toHaveBeenLastCalledWith({ expectedUnits: { USD: 2 }, amountMinor: 9, balanceId: BAL });
});

test("salary_update needs both fields without a saved salary, clears on request and maps errors", async () => {
  getProfile.mockResolvedValue(profile(null));
  await expect(tool("salary_update").run({ amountMinor: 5 })).rejects.toBeInstanceOf(ToolError);
  expect(saveSalary).not.toHaveBeenCalled();
  clearSalary.mockResolvedValue({ ok: true });
  await expect(tool("salary_update").run({ clear: true })).resolves.toEqual(profile(null));
  expect(clearSalary).toHaveBeenCalledWith();
  saveSalary.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("salary_update").run({ amountMinor: 5, balanceId: BAL })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.conflict });
  await expect(tool("salary_update").run({ amountMinor: 5, balanceId: RECEIPT })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.walletUnavailable });
  clearSalary.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("salary_update").run({ clear: true })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.failed });
});

test("salary_update input is strict and validates", () => {
  const input = tool("salary_update").input!;
  expect(input.safeParse({ amountMinor: 1 }).success).toBe(true);
  expect(input.safeParse({ clear: true }).success).toBe(true);
  expect(input.safeParse({}).success).toBe(false);
  expect(input.safeParse({ clear: true, amountMinor: 1 }).success).toBe(false);
  expect(input.safeParse({ clear: false }).success).toBe(false);
  expect(input.safeParse({ amountMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ amountMinor: 1.5 }).success).toBe(false);
  expect(input.safeParse({ balanceId: "x" }).success).toBe(false);
  expect(input.safeParse({ amountMinor: 1, currency: "USD" }).success).toBe(false);
});

test("salary_mark_received calls the app's receiveSalary and returns status, receipt and balances", async () => {
  getProfile.mockResolvedValue(profile({ amountMinor: 150000, balanceId: BAL }));
  receiveSalary.mockResolvedValue({ ok: true, id: REQ, revision: 1 });
  const status = { receiptId: REQ, lastReceivedOn: "2026-11-25", receivedThisMonth: true };
  getSalaryStatus.mockResolvedValue(status);
  const out = (await tool("salary_mark_received").run({ requestId: REQ, expectedReceiptId: RECEIPT })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(receiveSalary).toHaveBeenCalledWith({ requestId: REQ, expectedCycleId: RECEIPT });
  expect(getSalaryStatus).toHaveBeenCalledWith("Asia/Beirut");
  expect(out.status).toEqual(status);
  expect(out.receipt).toEqual({ id: REQ, revision: 1 });
  expect(out.balances[0].balances[0]).toMatchObject({ id: BAL, amount: { minor: 150000, currency: "USD" } });
});

test("salary_mark_received generates a requestId, passes a null cycle, and a retry returns the same receipt", async () => {
  getProfile.mockResolvedValue(profile({ amountMinor: 150000, balanceId: BAL }));
  receiveSalary.mockImplementation(async (input: { requestId: string }) => ({ ok: true, id: input.requestId, revision: 1 }));
  getSalaryStatus.mockResolvedValue({ receiptId: null, lastReceivedOn: null, receivedThisMonth: false });
  await tool("salary_mark_received").run({ expectedReceiptId: null });
  expect(receiveSalary.mock.calls[0][0]).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), expectedCycleId: null });
  const first = await tool("salary_mark_received").run({ requestId: REQ, expectedReceiptId: null });
  await expect(tool("salary_mark_received").run({ requestId: REQ, expectedReceiptId: null })).resolves.toEqual(first);
});

test("salary_mark_received maps errors to fixed sentences", async () => {
  receiveSalary.mockResolvedValue({ ok: false, error: "cycleChanged" });
  await expect(tool("salary_mark_received").run({ requestId: REQ, expectedReceiptId: null })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.cycleChanged });
  receiveSalary.mockResolvedValue({ ok: false, error: "requestAlreadyUsed" });
  await expect(tool("salary_mark_received").run({ requestId: REQ, expectedReceiptId: null })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.requestAlreadyUsed });
  receiveSalary.mockResolvedValue({ ok: false, error: "invalid" });
  await expect(tool("salary_mark_received").run({ requestId: REQ, expectedReceiptId: null })).rejects.toMatchObject({ message: expect.stringMatching(/salary_update/) });
  receiveSalary.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("salary_mark_received").run({ requestId: REQ, expectedReceiptId: null })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.failed });
});

test("salary_mark_received input is strict and requires the expected receipt", () => {
  const input = tool("salary_mark_received").input!;
  expect(input.safeParse({ expectedReceiptId: null }).success).toBe(true);
  expect(input.safeParse({ expectedReceiptId: RECEIPT, requestId: REQ }).success).toBe(true);
  expect(input.safeParse({}).success).toBe(false);
  expect(input.safeParse({ expectedReceiptId: "x" }).success).toBe(false);
  expect(input.safeParse({ expectedReceiptId: null, amountMinor: 5 }).success).toBe(false);
});
