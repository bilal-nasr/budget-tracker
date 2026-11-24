import { afterEach, beforeEach, expect, it } from "vitest";
import { vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const id = "3f1c6a2e-9b7d-4c1a-8e2f-0a1b2c3d4e5f";
const consent = (query: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`https://internal.example/oauth/consent${query}`, { headers }));

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example"));
afterEach(() => vi.unstubAllEnvs());

it("sends a valid authorization to the connect page in English by default, uncached", async () => {
  const response = await consent("?authorization_id=abc12345");
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://budget.example/en/connect?authorization_id=abc12345");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

it.each([
  [{ cookie: "NEXT_LOCALE=ar" }, "ar"],
  [{ cookie: "NEXT_LOCALE=en", "accept-language": "ar" }, "en"],
  [{ cookie: "NEXT_LOCALE=fr", "accept-language": "ar-LB,ar;q=0.9,en;q=0.8" }, "ar"],
  [{ "accept-language": "fr-FR, ar;q=0.5, en;q=0.9" }, "en"],
  [{ "accept-language": "fr-FR, de" }, "en"],
  [{ "accept-language": "AR" }, "ar"],
])("picks the locale from the saved cookie, then the browser's languages (%o → %s)", async (headers, locale) => {
  const response = await consent(`?authorization_id=${id}`, headers);
  expect(response.headers.get("location")).toBe(`https://budget.example/${locale}/connect?authorization_id=${id}`);
});

it.each(["", "?authorization_id=", "?authorization_id=short", "?authorization_id=../../evil", `?authorization_id=${id}%2F..`, "?authorization_id=https://evil.example"])(
  "a missing or malformed id (%s) lands on the connect page with no query",
  async (query) => {
    const response = await consent(query, { cookie: "NEXT_LOCALE=ar" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://budget.example/ar/connect");
  },
);

it("never carries any other query parameter along", async () => {
  const response = await consent(`?authorization_id=${id}&redirect_uri=https://evil.example&next=//evil.example`);
  expect(response.headers.get("location")).toBe(`https://budget.example/en/connect?authorization_id=${id}`);
});

it("falls back to the request origin when no site URL is configured", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  const response = await consent(`?authorization_id=${id}`);
  expect(response.headers.get("location")).toBe(`https://internal.example/en/connect?authorization_id=${id}`);
});
