import { beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSalaryStatus = vi.fn();
const getProfile = vi.fn();
vi.mock("./queries", () => ({ getSalaryStatus: (...args: unknown[]) => getSalaryStatus(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
import { salaryTools } from "./mcp";

beforeEach(() => {
  vi.resetAllMocks();
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
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
