import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET, OPTIONS } from "../.well-known/[...path]/route";

// Tests for app/.well-known/[...path]/route.ts, kept beside the endpoint's tests.
let base: string;
let counter = 0;
const metadata = () => ({
  issuer: `${base}/auth/v1`,
  authorization_endpoint: `${base}/auth/v1/oauth/authorize`,
  token_endpoint: `${base}/auth/v1/oauth/token`,
  registration_endpoint: `${base}/auth/v1/oauth/clients/register`,
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256", "plain"],
});
const call = (path: string[], method = "GET") =>
  (method === "OPTIONS" ? OPTIONS : GET)(
    new Request(`http://localhost:3000/.well-known/${path.join("/")}`, { method }),
    { params: Promise.resolve({ path }) },
  );

beforeEach(() => {
  // A fresh project address per test keeps the module's one-hour cache out of the way.
  base = `https://discovery-${++counter}.supabase.test`;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example.com");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(metadata())));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("protected-resource metadata names this endpoint and the Supabase authorization server", async () => {
  const response = await call(["oauth-protected-resource", "mcp"]);
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(await response.json()).toMatchObject({
    resource: "https://budget.example.com/mcp",
    authorization_servers: [`${base}/auth/v1`],
  });
});

test("a local http://127.0.0.1 issuer is accepted", async () => {
  base = "http://127.0.0.1:54321";
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base);
  const response = await call(["oauth-protected-resource", "mcp"]);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ authorization_servers: ["http://127.0.0.1:54321/auth/v1"] });
});

test("authorization-server metadata is passed through", async () => {
  const response = await call(["oauth-authorization-server"]);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(metadata());
});

test("an unknown well-known path → 404", async () => {
  expect((await call(["security.txt"])).status).toBe(404);
  expect((await call(["oauth-protected-resource", "elsewhere"])).status).toBe(404);
});

test("a path that is not one of the served documents → 404 without fetching metadata", async () => {
  const fetchMock = vi.fn(async () => Response.json(metadata()));
  vi.stubGlobal("fetch", fetchMock);
  for (const path of [
    ["oauth-protected-resource", "elsewhere"],
    ["oauth-protected-resource"],
    ["oauth-protected-resource", "mcp", "extra"],
    ["oauth-authorization-server", "auth", "v1"],
    ["security.txt"],
  ]) {
    expect((await call(path)).status, path.join("/")).toBe(404);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a trailing slash still serves the document (the SDK strips it)", async () => {
  expect((await call(["oauth-protected-resource", "mcp", ""])).status).toBe(200);
});

test("with a base path the protected-resource document names the base-path endpoint", async () => {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/budget");
  const response = await call(["oauth-protected-resource", "budget", "mcp"]);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ resource: "https://budget.example.com/budget/mcp" });
  expect((await call(["oauth-protected-resource", "mcp"])).status).toBe(404);
});

test("neither metadata address answers → 503", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
  expect((await call(["oauth-protected-resource", "mcp"])).status).toBe(503);
});

test("OPTIONS answers a CORS preflight", async () => {
  const response = await call(["oauth-protected-resource", "mcp"], "OPTIONS");
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-methods")).toContain("GET");
});
