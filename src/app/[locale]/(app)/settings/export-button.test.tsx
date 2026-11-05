// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { ExportButton } from "./export-button";

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => "blob:accountant-export");
const revokeObjectURL = vi.fn();
const clickedDownloads: Array<{ href: string; download: string }> = [];

function view(locale: "en" | "ar" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
      <ExportButton />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clickedDownloads.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clickedDownloads.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("downloads the workbook using the active locale and server filename", async () => {
  fetchMock.mockResolvedValue(new Response("xlsx", {
    status: 200,
    headers: {
      "Content-Disposition": 'attachment; filename="budget-export-2026-11-05.xlsx"',
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  }));
  view("ar");
  fireEvent.click(screen.getByRole("button", { name: ar.Settings.exportButton }));
  await waitFor(() => expect(clickedDownloads).toEqual([
    { href: "blob:accountant-export", download: "budget-export-2026-11-05.xlsx" },
  ]));
  expect(fetchMock).toHaveBeenCalledWith("/ar/settings/export", { method: "GET", redirect: "error" });
});

it("disables the button and announces progress while the export is generated", async () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  view();
  fireEvent.click(screen.getByRole("button", { name: en.Settings.exportButton }));
  expect(screen.getByRole("button", { name: en.Settings.exportPreparing }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toContain(en.Settings.exportPreparing);
});

it("shows a localized retry message when the export response fails", async () => {
  fetchMock.mockResolvedValue(new Response("failed", { status: 500 }));
  view("ar");
  fireEvent.click(screen.getByRole("button", { name: ar.Settings.exportButton }));
  expect((await screen.findByRole("alert")).textContent).toContain(ar.Settings.exportFailed);
});

it("rejects a successful HTML response instead of downloading it as Excel", async () => {
  fetchMock.mockResolvedValue(new Response("<html>sign in</html>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));
  view("ar");
  fireEvent.click(screen.getByRole("button", { name: ar.Settings.exportButton }));
  expect((await screen.findByRole("alert")).textContent).toContain(ar.Settings.exportFailed);
  expect(clickedDownloads).toHaveLength(0);
});

it("revokes the temporary object URL after starting the download", async () => {
  fetchMock.mockResolvedValue(new Response("xlsx", {
    status: 200,
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  }));
  view();
  fireEvent.click(screen.getByRole("button", { name: en.Settings.exportButton }));
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:accountant-export"));
  expect(clickedDownloads).toHaveLength(1);
});
