import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getProfile = vi.fn();
const getCurrencies = vi.fn();
const updateProfile = vi.fn();
const setDefaultCurrency = vi.fn();
const setSalaryEmail = vi.fn();
const saveLocale = vi.fn();
vi.mock("./queries", () => ({ getProfile: () => getProfile() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
vi.mock("./actions", () => ({
  updateProfile: (...args: unknown[]) => updateProfile(...args),
  setDefaultCurrency: (...args: unknown[]) => setDefaultCurrency(...args),
  setSalaryEmail: (...args: unknown[]) => setSalaryEmail(...args),
  saveLocale: (...args: unknown[]) => saveLocale(...args),
}));
import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { profileTools } from "./mcp";

const tool = (name: string) => profileTools.find((t) => t.name === name)!;
const profile = {
  locale: "en", digits: "latin", theme: "system", timezone: "Asia/Beirut", onboarded: true,
  defaultCurrency: "USD", salaryEmail: true, usdLbpRate: 89500, salary: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  getProfile.mockResolvedValue(profile);
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  for (const action of [updateProfile, setDefaultCurrency, setSalaryEmail, saveLocale]) action.mockResolvedValue({ ok: true });
});

test("profile_get is a read that returns the profile", async () => {
  expect(profileTools[0].name).toBe("profile_get");
  expect(tool("profile_get").kind).toBe("read");
  await expect(tool("profile_get").run({})).resolves.toEqual(profile);
});

test("profile_update is a write and maps every field to the action that owns it", async () => {
  expect(tool("profile_update").kind).toBe("write");
  const updated = { ...profile, locale: "ar", theme: "dark", digits: "arabic", defaultCurrency: "LBP", salaryEmail: false };
  getProfile.mockResolvedValue(updated);
  const out = await tool("profile_update").run({ defaultCurrency: "LBP", locale: "ar", theme: "dark", digits: "arabic", salaryEmail: false });
  expect(setDefaultCurrency).toHaveBeenCalledWith("LBP");
  expect(saveLocale).toHaveBeenCalledWith("ar");
  expect(updateProfile).toHaveBeenCalledWith({ theme: "dark", digits: "arabic" });
  expect(setSalaryEmail).toHaveBeenCalledWith(false);
  expect(out).toEqual(updated);
});

test("profile_update calls only the actions for the fields sent", async () => {
  await tool("profile_update").run({ theme: "light" });
  expect(updateProfile).toHaveBeenCalledWith({ theme: "light" });
  expect(setDefaultCurrency).not.toHaveBeenCalled();
  expect(setSalaryEmail).not.toHaveBeenCalled();
  expect(saveLocale).not.toHaveBeenCalled();
  await tool("profile_update").run({ salaryEmail: true });
  expect(setSalaryEmail).toHaveBeenCalledWith(true);
  expect(updateProfile).toHaveBeenCalledTimes(1);
});

test("profile_update refuses a currency outside the list or disabled, before any change", async () => {
  await expect(tool("profile_update").run({ defaultCurrency: "EUR", theme: "dark" })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.currencyUnavailable });
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS.map((c) => (c.code === "SYP" ? { ...c, disabled: true } : c)));
  await expect(tool("profile_update").run({ defaultCurrency: "SYP" })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.currencyDisabled });
  expect(setDefaultCurrency).not.toHaveBeenCalled();
  expect(updateProfile).not.toHaveBeenCalled();
});

test("profile_update turns an action error into the fixed sentence", async () => {
  saveLocale.mockResolvedValue({ ok: false, error: "invalid" });
  await expect(tool("profile_update").run({ locale: "en" })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.invalid });
  updateProfile.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("profile_update").run({ theme: "dark" })).rejects.toBeInstanceOf(ToolError);
  await expect(tool("profile_update").run({ theme: "dark" })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.failed });
  setSalaryEmail.mockResolvedValue({ ok: false, error: "notConfigured" });
  await expect(tool("profile_update").run({ salaryEmail: true })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.notConfigured });
});

test("profile_update input is strict, needs one field and validates values", () => {
  const input = tool("profile_update").input!;
  expect(input.safeParse({ theme: "dark" }).success).toBe(true);
  expect(input.safeParse({}).success).toBe(false);
  expect(input.safeParse({ theme: "blue" }).success).toBe(false);
  expect(input.safeParse({ locale: "fr" }).success).toBe(false);
  expect(input.safeParse({ digits: "roman" }).success).toBe(false);
  expect(input.safeParse({ salaryEmail: "yes" }).success).toBe(false);
  expect(input.safeParse({ defaultCurrency: "usd!" }).success).toBe(false);
  expect(input.safeParse({ usdLbpRate: 89500 }).success).toBe(false);
  expect(input.safeParse({ timezone: "UTC" }).success).toBe(false);
  const parsed = input.safeParse({ defaultCurrency: " lbp " });
  expect(parsed.success && parsed.data.defaultCurrency).toBe("LBP");
});
