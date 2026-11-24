// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

const revoke = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/features/connect/actions", () => ({ revokeConnectedApp: (id: string) => revoke(id) }));
vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));

import { ConnectedAppsView } from "./connected-apps-view";

const ADDRESS = "https://budget.example.test/mcp";
const APP_ID = "7c1e2b9a-4f3d-4a6b-9c0e-2d5f8a1b3c4d";
const APP = { clientId: "11111111-2222-4333-8444-555555555555", name: "Claude", grantedAt: "2026-11-20T10:00:00Z" };

function view(props: Partial<React.ComponentProps<typeof ConnectedAppsView>> = {}, locale: "en" | "ar" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
      <ConnectedAppsView apps={[]} address={ADDRESS} appIds={[{ clientId: APP_ID, name: "Claude" }]} {...props} />
    </NextIntlClientProvider>,
  );
}

const copy = en.Settings.connectedApps;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

it("with no apps, shows the empty line and the help open with the address and app id", () => {
  const { container } = view();
  expect(screen.getByText(copy.empty)).toBeTruthy();
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
  expect(screen.getByText(ADDRESS)).toBeTruthy();
  expect(screen.getByText(APP_ID)).toBeTruthy();
  // Each value is shown left to right and isolated, in Arabic too.
  expect(screen.getByText(ADDRESS).closest("bdi")?.getAttribute("dir")).toBe("ltr");
  // Each Copy button is named for what it copies.
  expect(screen.getByRole("button", { name: copy.copyAddress })).toBeTruthy();
  expect(screen.getByRole("button", { name: copy.copyAppId })).toBeTruthy();
  expect(copy.copyAddress).not.toBe(copy.copyAppId);
  expect(container.querySelectorAll("ol > li")).toHaveLength(3);
});

it("with several registered apps, each app id's Copy button names its app", () => {
  view({ appIds: [{ clientId: APP_ID, name: "Claude" }, { clientId: APP.clientId, name: "Other" }] });
  expect(screen.getByRole("button", { name: "Copy app ID for Claude" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy app ID for Other" })).toBeTruthy();
});

it("the app id step is left out when no app was registered, the address stays", () => {
  const { container } = view({ appIds: [] });
  expect(screen.getByText(ADDRESS)).toBeTruthy();
  expect(container.querySelectorAll("ol > li")).toHaveLength(2);
});

it("Copy writes the value to the clipboard and says Copied", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  view();
  fireEvent.click(screen.getByRole("button", { name: copy.copyAddress }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS));
  await waitFor(() => expect(screen.getByText(copy.copied)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: copy.copyAppId }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(APP_ID));
  expect(screen.queryByText(copy.copyFailed)).toBeNull();
  vi.unstubAllGlobals();
});

it("when the clipboard refuses, the value is selected and a hint says to copy it by hand", async () => {
  const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  view();
  fireEvent.click(screen.getByRole("button", { name: copy.copyAddress }));
  const hint = await screen.findByText(copy.copyFailed);
  expect(hint.getAttribute("aria-live")).toBe("polite");
  expect(screen.queryByText(copy.copied)).toBeNull();
  expect(window.getSelection()?.toString()).toBe(ADDRESS);
  vi.unstubAllGlobals();
});

it("with no clipboard at all (a plain http address), the hint shows in Arabic too", async () => {
  vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
  view({}, "ar");
  fireEvent.click(screen.getByRole("button", { name: ar.Settings.connectedApps.copyAppId }));
  expect(await screen.findByText(ar.Settings.connectedApps.copyFailed)).toBeTruthy();
  vi.unstubAllGlobals();
});

it("a listed app shows its name in <bdi>, its date, a 44px-tall Remove, and the help folded", () => {
  const { container } = view({ apps: [APP] });
  const row = container.querySelector("ul > li") as HTMLElement;
  expect(within(row).getByText("Claude").tagName).toBe("BDI");
  expect(screen.getByText("Nov 20, 2026")).toBeTruthy();
  const remove = screen.getByRole("button", { name: "Remove Claude" });
  expect(remove.textContent).toBe(copy.remove);
  expect(remove.className).toContain("h-11");
  expect(screen.queryByText(copy.empty)).toBeNull();
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
});

it("an app with no name gets the translated fallback", () => {
  view({ apps: [{ ...APP, name: "" }] });
  expect(screen.getByRole("button", { name: `Remove ${copy.unnamedApp}` })).toBeTruthy();
});

it("null apps show the could-not-load line and no list, the help stays", () => {
  const { container } = view({ apps: null });
  expect(screen.getByRole("alert").textContent).toBe(copy.loadFailed);
  expect(container.querySelector("ul")).toBeNull();
  expect(screen.getByText(ADDRESS)).toBeTruthy();
});

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: "Remove Claude" }));
  return screen.findByRole("dialog");
}

it("the remove sheet names the app, says it can see the budget, and the delay of up to a minute", async () => {
  view({ apps: [APP] });
  const dialog = await openSheet();
  expect(within(dialog).getByText(/will no longer be able to see your budget\./)).toBeTruthy();
  expect(within(dialog).getByText(copy.takesEffect)).toBeTruthy();
  expect(copy.takesEffect).toContain("a minute");
  expect(copy.removeConfirmBody).not.toContain("change");
  expect(revoke).not.toHaveBeenCalled();
});

it("confirming Remove calls the action with the app id, drops the row and says Removed", async () => {
  revoke.mockResolvedValue({ ok: true });
  view({ apps: [APP] });
  const dialog = await openSheet();
  fireEvent.click(within(dialog).getByRole("button", { name: copy.remove }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith(APP.clientId));
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(copy.removed));
  expect(screen.queryByRole("button", { name: "Remove Claude" })).toBeNull();
  expect(screen.getByText(copy.empty)).toBeTruthy();
});

it("a failed removal shows an error and keeps the row", async () => {
  revoke.mockResolvedValue({ ok: false, error: "failed" });
  view({ apps: [APP] });
  const dialog = await openSheet();
  fireEvent.click(within(dialog).getByRole("button", { name: copy.remove }));
  await waitFor(() => expect(toastError).toHaveBeenCalledWith(copy.removeFailed));
  expect(screen.getByRole("button", { name: "Remove Claude" })).toBeTruthy();
  expect(toastSuccess).not.toHaveBeenCalled();
});

it("cancelling does nothing", async () => {
  view({ apps: [APP] });
  const dialog = await openSheet();
  fireEvent.click(within(dialog).getByRole("button", { name: copy.cancel }));
  expect(revoke).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Remove Claude" })).toBeTruthy();
});

it("renders in Arabic with its own words", () => {
  view({ apps: [APP] }, "ar");
  expect(screen.getByRole("heading", { name: ar.Settings.connectedApps.title })).toBeTruthy();
  expect(screen.getByRole("button", { name: "إزالة Claude" })).toBeTruthy();
});
