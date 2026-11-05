import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  getUserId: vi.fn(),
  getExportData: vi.fn(),
  writeExportWorkbook: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/user", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/features/export/data", () => ({ getExportData: mocks.getExportData }));
vi.mock("@/features/export/workbook", () => ({ writeExportWorkbook: mocks.writeExportWorkbook }));

import { GET } from "./route";

function request(locale: string) {
  return GET(new Request(`https://budget.example/${locale}/settings/export`), {
    params: Promise.resolve({ locale }),
  } as RouteContext<"/[locale]/settings/export">);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.getUserId.mockResolvedValue("user-id");
  mocks.getExportData.mockResolvedValue({ cutoffDate: "2026-11-05" });
  mocks.writeExportWorkbook.mockResolvedValue(Buffer.from([1, 2, 3, 4]));
});

it("downloads the selected-locale workbook with xlsx headers and no-store caching", async () => {
  const response = await request("ar");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="budget-export-2026-11-05.xlsx"');
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("cache-control")).toContain("private");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
});

it("allows the unconfigured demo export without a session", async () => {
  mocks.configured = false;
  mocks.getUserId.mockResolvedValue(null);
  const response = await request("en");
  expect(response.status).toBe(200);
});

it("returns 401 with no-store headers when Supabase is configured and the user is signed out", async () => {
  mocks.getUserId.mockResolvedValue(null);
  const response = await request("en");
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
});

it("returns a generic 500 response with no-store headers when data collection or generation fails", async () => {
  mocks.getExportData.mockRejectedValue(new Error("sensitive database detail"));
  const response = await request("en");
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.text();
  expect(body).not.toContain("sensitive");
  expect(body).not.toContain("database");
});
