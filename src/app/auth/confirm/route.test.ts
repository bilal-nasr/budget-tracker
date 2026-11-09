import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.hoisted(() => vi.fn());
const pendingJoin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));
vi.mock("@/features/invoices/pending-join", () => ({ pendingJoinAfterSignIn: pendingJoin }));
import { GET } from "./route";

const user = "ac000000-0000-4000-8000-000000000009";
const token = "ab".repeat(32);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example");
  verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: user } }, error: null });
  pendingJoin.mockReset().mockResolvedValue(null);
});

it.each(["en", "ar"])("%s: a confirmed, set-up account goes to the remembered share link", async (locale) => {
  pendingJoin.mockResolvedValue(`/invoices/join/${token}`);
  const response = await GET(new NextRequest(`https://internal.example/auth/confirm?type=email&token_hash=synthetic&next=/${locale}/onboarding`));
  expect(response.headers.get("location")).toBe(`https://budget.example/${locale}/invoices/join/${token}`);
  expect(pendingJoin).toHaveBeenCalledWith(expect.anything(), user);
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("a new account still goes to onboarding (which uses the link when it finishes), and a reset link never takes it", async () => {
  const confirm = await GET(new NextRequest("https://internal.example/auth/confirm?type=email&token_hash=synthetic&next=/ar/onboarding"));
  expect(confirm.headers.get("location")).toBe("https://budget.example/ar/onboarding");
  pendingJoin.mockClear();
  const reset = await GET(new NextRequest("https://internal.example/auth/confirm?type=recovery&token_hash=synthetic&next=/en/reset-password"));
  expect(reset.headers.get("location")).toBe("https://budget.example/en/reset-password");
  expect(pendingJoin).not.toHaveBeenCalled();
});

it("a failed confirmation never takes the remembered link", async () => {
  verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "otp_expired" } });
  const response = await GET(new NextRequest("https://internal.example/auth/confirm?type=email&token_hash=synthetic&next=/en/onboarding"));
  expect(response.headers.get("location")).toBe("https://budget.example/en/sign-in?error=link");
  expect(pendingJoin).not.toHaveBeenCalled();
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
