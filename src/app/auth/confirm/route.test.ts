import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example");
  verifyOtp.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

it.each(["email", "recovery"])("never caches a successful %s confirmation redirect", async (type) => {
  const next = type === "email" ? "/ar/onboarding" : "/ar/reset-password";
  const response = await GET(new NextRequest(`https://internal.example/auth/confirm?type=${type}&token_hash=synthetic&next=${next}`));
  expect(response.headers.get("location")).toBe(`https://budget.example${next}`);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
});

it("never caches a failed recovery redirect and rejects external destinations", async () => {
  verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
  const response = await GET(new NextRequest("https://internal.example/auth/confirm?type=recovery&token_hash=synthetic&next=//evil.example"));
  expect(response.headers.get("location")).toBe("https://budget.example/en/forgot-password?error=link");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
