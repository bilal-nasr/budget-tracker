// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import type { InvoiceFolderSummary } from "@/features/invoices/schema";

const mocks = vi.hoisted(() => ({ createFolder: vi.fn() }));
vi.mock("@/features/invoices/actions", () => ({ createFolder: mocks.createFolder }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/components/shell/screen-header", () => ({
  ScreenHeader: ({ title, children }: { title?: string; children?: React.ReactNode }) => <header><h1>{title}</h1>{children}</header>,
}));
import { FoldersView } from "./folders-view";

const catalogs = { en, ar } as const;
type Locale = keyof typeof catalogs;
const currencies: CurrencyDefinition[] = [
  { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
  { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true },
];

const folder = (n: number, over: Partial<InvoiceFolderSummary> = {}): InvoiceFolderSummary => ({
  id: `ac000000-0000-4000-8000-00000000000${n}`, name: `Folder ${n}`, isOwner: true, memberCount: 1, itemCount: 2,
  totals: [{ currency: "USD", decimalPlaces: 2, minor: 80000 }], ...over,
});

const view = (locale: Locale, folders: InvoiceFolderSummary[], unavailable = false) => (
  <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
    <AppDataProvider walletContainers={[]} currencies={currencies} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}>
      <FoldersView folders={folders} unavailable={unavailable} />
    </AppDataProvider>
  </NextIntlClientProvider>
);

const nameField = (locale: Locale) => screen.getByRole("textbox", { name: catalogs[locale].Invoices.folderName });
const createButton = (locale: Locale) => screen.getByRole("button", { name: catalogs[locale].Invoices.createFolder });
const rowOf = (name: string) => screen.getByText(name).closest("li")!;
const type = (locale: Locale, value: string) => fireEvent.change(nameField(locale), { target: { value } });

beforeEach(() => { mocks.createFolder.mockReset().mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe.each(["en", "ar"] as const)("%s", (locale) => {
  const t = catalogs[locale].Invoices;

  it("shows each folder as a link with its name in <bdi>, row count and totals", () => {
    render(view(locale, [
      folder(1, { name: "PC build", itemCount: 5, totals: [{ currency: "USD", decimalPlaces: 2, minor: 80000 }, { currency: "LBP", decimalPlaces: 0, minor: 2500000 }] }),
      folder(2, { name: "Laptop", itemCount: 1 }),
    ]));
    const pc = rowOf("PC build");
    expect(screen.getByText("PC build").tagName).toBe("BDI");
    expect(within(pc).getByRole("link").getAttribute("href")).toBe("/invoices/ac000000-0000-4000-8000-000000000001");
    expect(pc.textContent).toContain("$800.00");
    expect(pc.textContent).toContain("LBP 2,500,000");
    expect(pc.textContent).not.toContain("+");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    // Amounts are isolated LTR runs and never mirror.
    expect(pc.querySelector('bdi[dir="ltr"]')?.textContent).toBe("$800.00");
  });

  it("counts rows with the plural form of the language", () => {
    render(view(locale, [
      folder(1, { name: "Zero", itemCount: 0, totals: [] }),
      folder(2, { name: "One", itemCount: 1 }),
      folder(3, { name: "Many", itemCount: 12 }),
    ]));
    const words = locale === "ar" ? { zero: "لا بنود", one: "بند واحد", many: "12 بنداً" } : { zero: "0 items", one: "1 item", many: "12 items" };
    expect(rowOf("Zero").textContent).toContain(words.zero);
    expect(rowOf("One").textContent).toContain(words.one);
    expect(rowOf("Many").textContent).toContain(words.many);
  });

  it("shows at most two currency totals, then +N for the rest", () => {
    render(view(locale, [folder(1, {
      name: "Big",
      totals: [
        { currency: "USD", decimalPlaces: 2, minor: 100 },
        { currency: "LBP", decimalPlaces: 0, minor: 200 },
        { currency: "EUR", decimalPlaces: 2, minor: 300 },
        { currency: "SYP", decimalPlaces: 0, minor: 400 },
      ],
    })]));
    const text = rowOf("Big").textContent!;
    expect(text).toContain("$1.00");
    expect(text).toContain("LBP 200");
    expect(text).not.toContain("300");
    expect(text).not.toContain("400");
    expect(text).toContain("+2");
    // The marker is its own LTR run, so it reads "+2" and never "2+" in Arabic.
    const marker = [...rowOf("Big").querySelectorAll('bdi[dir="ltr"]')].find((node) => node.textContent === "+2");
    expect(marker).toBeTruthy();
  });

  it("a total that is out of range says it is too large instead of a number", () => {
    render(view(locale, [folder(1, { name: "Huge", totals: [{ currency: "USD", decimalPlaces: 2, minor: null }] })]));
    const line = t.totalTooLarge.replace("<bdi>{currency}</bdi>", "USD");
    expect(rowOf("Huge").textContent).toContain(line);
    expect(line).toContain("USD:");
    // The code is an isolated LTR run, so the colon follows it in either language.
    expect(rowOf("Huge").querySelector('bdi[dir="ltr"]')?.textContent).toBe("USD");
  });

  it("a currency the viewer never enabled does not crash and shows its own code", () => {
    render(view(locale, [folder(1, { name: "Imported", totals: [{ currency: "EUR", decimalPlaces: 2, minor: 12345 }] })]));
    expect(rowOf("Imported").textContent).toContain("EUR 123.45");
  });

  it("marks shared folders: Shared for an owner with others, Shared with you for a joined folder", () => {
    render(view(locale, [
      folder(1, { name: "Mine alone" }),
      folder(2, { name: "Mine shared", memberCount: 3 }),
      folder(3, { name: "Theirs", isOwner: false, memberCount: 2 }),
    ]));
    expect(rowOf("Mine alone").textContent).not.toContain(t.shared);
    expect(rowOf("Mine shared").textContent).toContain(t.shared);
    expect(rowOf("Mine shared").textContent).not.toContain(t.sharedWithYou);
    expect(rowOf("Theirs").textContent).toContain(t.sharedWithYou);
  });

  it("an empty list shows the empty state and still offers the create form", () => {
    render(view(locale, []));
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyBody)).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(nameField(locale)).toBeTruthy();
  });

  it("keeps Create disabled until there is a real name", () => {
    render(view(locale, []));
    expect((createButton(locale) as HTMLButtonElement).disabled).toBe(true);
    type(locale, "   ");
    expect((createButton(locale) as HTMLButtonElement).disabled).toBe(true);
    type(locale, " PC build ");
    expect((createButton(locale) as HTMLButtonElement).disabled).toBe(false);
    expect(nameField(locale).getAttribute("maxlength")).toBe("60");
  });

  it("adds the new folder at once with a client id, saves it trimmed, and clears the field", async () => {
    let finish!: (value: { ok: true }) => void;
    mocks.createFolder.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(view(locale, [folder(1, { name: "Old" })]));
    type(locale, "  PC build ");
    await act(async () => { fireEvent.click(createButton(locale)); });

    expect(mocks.createFolder).toHaveBeenCalledTimes(1);
    const sent = mocks.createFolder.mock.calls[0][0] as { id: string; name: string };
    expect(sent.name).toBe("PC build");
    expect(sent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // New folder first, before the server answers; it does not link until it is saved.
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("PC build");
    expect(items[0].getAttribute("aria-busy")).toBe("true");
    expect(within(items[0]).queryByRole("link")).toBeNull();
    expect((nameField(locale) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => { finish({ ok: true }); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("on failure the text comes back with the reason, and a retry reuses the same id", async () => {
    mocks.createFolder.mockResolvedValueOnce({ ok: false, error: "limitReached" });
    render(view(locale, []));
    type(locale, "PC build");
    await act(async () => { fireEvent.click(createButton(locale)); });

    expect((nameField(locale) as HTMLInputElement).value).toBe("PC build");
    expect(screen.getByRole("alert").textContent).toBe(t.errorLimit);
    expect(screen.queryByText("PC build", { selector: "bdi" })).toBeNull();

    await act(async () => { fireEvent.click(createButton(locale)); });
    const [first, second] = mocks.createFolder.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(second).toBe(first);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a retry with edited text gets a new id; unchanged text keeps the old one", async () => {
    mocks.createFolder.mockResolvedValue({ ok: false, error: "failed" });
    render(view(locale, []));
    type(locale, "PC build");
    await act(async () => { fireEvent.click(createButton(locale)); });
    type(locale, "PC build 2");
    await act(async () => { fireEvent.click(createButton(locale)); });
    type(locale, "PC build");
    await act(async () => { fireEvent.click(createButton(locale)); });
    const ids = mocks.createFolder.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(new Set([ids[0], ids[1]]).size).toBe(2);
    // The first text again, after an edit and a failed save of the edit, is a new attempt as well.
    expect(ids[2]).not.toBe(ids[1]);
  });

  it("after a conflict (the id is taken) even an unchanged retry gets a new id", async () => {
    mocks.createFolder.mockResolvedValueOnce({ ok: false, error: "conflict" });
    render(view(locale, []));
    type(locale, "PC build");
    await act(async () => { fireEvent.click(createButton(locale)); });
    expect((nameField(locale) as HTMLInputElement).value).toBe("PC build");
    await act(async () => { fireEvent.click(createButton(locale)); });
    const [first, second] = mocks.createFolder.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(second).not.toBe(first);
  });

  it("a second folder gets its own id", async () => {
    render(view(locale, []));
    type(locale, "One");
    await act(async () => { fireEvent.click(createButton(locale)); });
    type(locale, "Two");
    await act(async () => { fireEvent.click(createButton(locale)); });
    const ids = mocks.createFolder.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it("explains in preview mode that nothing can be saved", async () => {
    mocks.createFolder.mockResolvedValue({ ok: false, error: "notConfigured" });
    render(view(locale, []));
    type(locale, "PC build");
    await act(async () => { fireEvent.click(createButton(locale)); });
    expect(screen.getByRole("alert").textContent).toBe(t.errorPreview);
  });

  it("a thrown action is reported as a failure and keeps the text", async () => {
    mocks.createFolder.mockRejectedValue(new Error("network"));
    render(view(locale, []));
    type(locale, "PC build");
    await act(async () => { fireEvent.click(createButton(locale)); });
    expect(screen.getByRole("alert").textContent).toBe(t.errorFailed);
    expect((nameField(locale) as HTMLInputElement).value).toBe("PC build");
  });

  it("after losing access to a folder, says so above the list and drops the flag from the address", () => {
    window.history.replaceState(null, "", "/invoices?unavailable=1");
    render(view(locale, [folder(1, { name: "Still mine" })], true));
    const notice = screen.getByRole("status");
    expect(notice.textContent).toBe(t.folderLost);
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/invoices");
    expect(rowOf("Still mine")).toBeTruthy();
  });

  it("the notice's live region is in the server-rendered page empty, and the text is filled in once the page is up", () => {
    const html = renderToString(view(locale, [folder(1)], true));
    expect(html).toMatch(/<div role="status"[^>]*><\/div>/);
    expect(html).not.toContain(t.folderLost);
  });

  it("shows no notice on an ordinary visit", () => {
    render(view(locale, [folder(1)]));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
