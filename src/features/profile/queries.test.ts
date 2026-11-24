import { beforeEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({ createClient: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mock.configured }));
import { runAsConnector } from "@/lib/supabase/request-context";
import { getProfile } from "./queries";
import { DEFAULT_PROFILE } from "./schema";

type Result = { data: unknown; error: { message: string } | null };
/** Each select() answers with the next result in `results` (one per column set tried). */
function stub(...results: Result[]) {
  const queue = [...results];
  mock.createClient.mockResolvedValue({
    from: vi.fn(() => {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.maybeSingle = vi.fn(async () => queue.shift() ?? queue.at(-1) ?? results.at(-1));
      return q;
    }),
  });
}
const failed: Result = { data: null, error: { message: "boom" } };
const row = { locale: "ar", digits: "latin", theme: "system", timezone: "Asia/Beirut", onboarded_at: "2026-11-01T00:00:00Z" };
const asConnector = <T>(fn: () => Promise<T>) => runAsConnector({ accessToken: "t", userId: "00000000-0000-4000-8000-000000000001" }, fn);

beforeEach(() => {
  vi.clearAllMocks();
  mock.configured.mockReturnValue(true);
});

test("an older column set is still used when a newer one errors (migration not applied)", async () => {
  stub(failed, failed, failed, failed, { data: row, error: null });
  await expect(asConnector(() => getProfile())).resolves.toMatchObject({ locale: "ar", onboarded: true });
});

test("a browser request keeps the defaults when every read errors", async () => {
  stub(failed);
  // Outside a connector, getUserId reads the cookie session; stand it in.
  mock.createClient.mockResolvedValueOnce({ auth: { getClaims: async () => ({ data: { claims: { sub: "u" } } }) } });
  await expect(getProfile()).resolves.toEqual({ ...DEFAULT_PROFILE, onboarded: false });
});

test("a connector request throws when every read errors, instead of answering with defaults", async () => {
  stub(failed);
  await expect(asConnector(() => getProfile())).rejects.toThrow(Error);
});
