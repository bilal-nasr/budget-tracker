// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import { MAX_MINOR } from "@/lib/money";
import type { InvoiceCategory, InvoiceItem, InvoiceMember } from "@/features/invoices/schema";
import type { InvoiceFolderDetail } from "@/features/invoices/queries";
import { fakeRealtime } from "@/test/fake-realtime";

const mocks = vi.hoisted(() => ({
  addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), restoreItem: vi.fn(),
  renameFolder: vi.fn(), deleteFolder: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  realtime: null as ReturnType<typeof fakeRealtime> | null,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.realtime!.client }));
vi.mock("@/features/invoices/actions", () => ({
  addItem: mocks.addItem, updateItem: mocks.updateItem, deleteItem: mocks.deleteItem, restoreItem: mocks.restoreItem,
  renameFolder: mocks.renameFolder, deleteFolder: mocks.deleteFolder,
}));
vi.mock("@/features/invoices/queries", () => ({}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/components/shell/screen-header", () => ({
  ScreenHeader: ({ title, children }: { title?: string; children?: React.ReactNode }) => <header><h1>{title}</h1>{children}</header>,
}));
vi.mock("@/components/ui/sheet-shell", () => ({
  SheetShell: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
}));
import { FolderView, useFolderItems } from "./folder-view";

const catalogs = { en, ar } as const;
type Locale = keyof typeof catalogs;

const currencies: CurrencyDefinition[] = [
  { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
  { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true },
  { code: "SYP", symbol: "SYP", decimalPlaces: 0, disabled: true, firstUsed: false },
];

const VIEWER = "1a000000-0000-4000-8000-000000000001";
const KARIM = "1a000000-0000-4000-8000-000000000002";
const LINA = "1a000000-0000-4000-8000-000000000003";
const GONE = "1a000000-0000-4000-8000-000000000009";
const FOLDER = "1f000000-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const OTHER = "1c000000-0000-4000-8000-000000000001";
const otherCategory: InvoiceCategory = { id: OTHER, folderId: FOLDER, name: "Other", isDefault: true, createdAt: "2026-11-01T00:00:00Z" };

const item = (n: number, name: string, currency: string, decimalPlaces: number, priceMinor: number, createdBy: string | null = VIEWER, quantity = 1): InvoiceItem => ({
  id: `1d000000-0000-4000-8000-${String(n).padStart(12, "0")}`, folderId: FOLDER, categoryId: OTHER, name, currency, decimalPlaces, priceMinor, quantity, createdBy,
  createdAt: `2026-11-0${Math.min(9, n)}T00:00:00Z`, updatedAt: `2026-11-0${Math.min(9, n)}T00:00:00Z`,
});
const person = (userId: string, displayName: string | null, isOwner = false, removed = false): InvoiceMember =>
  ({ userId, displayName, isOwner, joinedAt: "2026-11-01T00:00:00Z", removed });

/** The spec's example: $800.00 and LBP 2,500,000, newest first. */
const pcItems = [
  item(5, "Fans", "LBP", 0, 1_000_000), item(4, "Cables", "LBP", 0, 1_500_000),
  item(3, "Case", "USD", 2, 10_000), item(2, "GPU", "USD", 2, 45_000), item(1, "CPU", "USD", 2, 25_000),
];

const folderOf = (over: Partial<InvoiceFolderDetail> = {}): InvoiceFolderDetail => ({
  id: FOLDER, name: "PC build", isOwner: true, viewerId: VIEWER, link: null, linkEnabled: true,
  members: [person(VIEWER, null, true)], items: pcItems, categories: [otherCategory], ...over,
});

const view = (locale: Locale, folder: InvoiceFolderDetail) => (
  <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
    <AppDataProvider walletContainers={[]} currencies={currencies} categories={[]} timezone="UTC" salary={null} usdLbpRate={null} defaultCurrency="USD">
      <FolderView folder={folder} />
    </AppDataProvider>
  </NextIntlClientProvider>
);

const list = () => screen.getByRole("list", { name: catalogsT().itemsLabel });
let current: Locale = "en";
const catalogsT = () => catalogs[current].Invoices;
const rowOf = (name: string) => screen.getByText(name, { selector: "bdi" }).closest("li")!;
const openRow = (name: string) => fireEvent.click(within(rowOf(name)).getByRole("button"));

/** The server's clock for saves: every save is later than the last, and later than every fixture row. */
let serverTick = 0;
const serverNow = () => `2026-11-09T12:00:${String(++serverTick).padStart(2, "0")}.000000+00:00`;
/** The fixture `item(n)` was created on day n (see `item`). */
const createdAtOf = (id: string) => `2026-11-0${Math.min(9, Number(id.slice(-12)))}T00:00:00Z`;

beforeEach(() => {
  for (const fn of [mocks.deleteItem, mocks.renameFolder, mocks.deleteFolder]) fn.mockReset().mockResolvedValue({ ok: true });
  // Undo puts the row back as it was, updated now.
  mocks.restoreItem.mockReset().mockImplementation(async (id: string) => ({ ok: true, createdAt: createdAtOf(id), updatedAt: serverNow() }));
  // Like the database: an add is created now; an edit keeps its creation time and is updated now.
  mocks.addItem.mockReset().mockImplementation(async () => { const now = serverNow(); return { ok: true, createdAt: now, updatedAt: now }; });
  mocks.updateItem.mockReset().mockImplementation(async (id: string) => ({ ok: true, createdAt: createdAtOf(id), updatedAt: serverNow() }));
  mocks.push.mockReset(); mocks.replace.mockReset(); mocks.refresh.mockReset();
  mocks.realtime = fakeRealtime();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  mocks.toast.mockReset(); mocks.toast.error.mockReset(); mocks.toast.success.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe.each(["en", "ar"] as const)("%s", (locale) => {
  const t = catalogs[locale].Invoices;
  beforeEach(() => { current = locale; });

  it("shows the folder name and one stacked total per currency, never one combined number", () => {
    render(view(locale, folderOf()));
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("PC build");
    const totals = within(header).getByRole("list", { name: t.totalsLabel });
    const lines = within(totals).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual(["$800.00", "LBP 2,500,000"]);
    // Each total is an isolated LTR amount of its own.
    expect(lines.every((line) => line.querySelector('bdi[dir="ltr"]'))).toBe(true);
    expect(header.textContent).not.toMatch(/2,500,800|25,080/);
    // A long total wraps at the space after the code first and splits digits only when it must.
    for (const line of lines) {
      const amount = line.querySelector(".amount")!;
      expect(amount.className).toContain("[overflow-wrap:anywhere]");
      expect(amount.className).not.toContain("break-all");
    }
  });

  it("each row shows its name and its own currency amount, newest first", () => {
    render(view(locale, folderOf()));
    const rows = within(list()).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("bdi:not([dir])")?.textContent)).toEqual(["Fans", "Cables", "Case", "GPU", "CPU"]);
    expect(rowOf("Cables").textContent).toContain("LBP 1,500,000");
    expect(rowOf("GPU").textContent).toContain("$450.00");
  });

  it("a row in a currency the viewer has not enabled shows its code and stored decimals and does not throw", () => {
    render(view(locale, folderOf({ items: [item(2, "Imported", "EUR", 2, 12_345), item(1, "Old", "SYP", 0, 5000)] })));
    expect(rowOf("Imported").textContent).toContain("EUR 123.45");
    expect(rowOf("Old").textContent).toContain("SYP 5,000");
    const header = screen.getByRole("banner").textContent!;
    expect(header).toContain("EUR 123.45");
    expect(header).toContain("SYP 5,000");
  });

  it("a total that cannot be summed says it is too large to show", () => {
    render(view(locale, folderOf({ items: [item(2, "A", "USD", 2, MAX_MINOR), item(1, "B", "USD", 2, MAX_MINOR), item(3, "C", "LBP", 0, 100)] })));
    const totals = within(screen.getByRole("banner")).getByRole("list", { name: t.totalsLabel });
    const lines = within(totals).getAllByRole("listitem");
    expect(lines[0].textContent).toBe(t.totalTooLarge.replace("<bdi>{currency}</bdi>", "USD"));
    expect(lines[0].textContent).toContain("USD:");
    expect(lines[0].querySelector('bdi[dir="ltr"]')?.textContent).toBe("USD");
    expect(lines[1].textContent).toBe("LBP 100");
  });

  it("a 60-character Arabic and Latin name wraps instead of overflowing", () => {
    // Names are trimmed when saved, so the fixture ends in a letter: Arabic, then one long unbroken Latin run.
    const long = `بطاقة رسوميات GeForce-RTX-5090-Founders-Edition-${"x".repeat(60)}`.slice(0, 60);
    expect(long).toHaveLength(60);
    render(view(locale, folderOf({ items: [item(1, long, "USD", 2, 199_999)] })));
    const ul = list();
    ul.style.width = "360px";
    expect(ul.scrollWidth).toBeLessThanOrEqual(ul.clientWidth);
    const name = screen.getByText(long, { selector: "bdi" });
    // jsdom does no layout, so also pin the classes that make the row wrap: a shrinking name column and an unbreakable amount.
    expect(name.closest("span")!.className).toMatch(/min-w-0/);
    expect(name.closest("span")!.className).toMatch(/overflow-wrap:anywhere|break-words/);
    expect(rowOf(long).querySelector('bdi[dir="ltr"]')!.closest("span,bdi")!.className).toMatch(/shrink-0|amount/);
  });

  it("an empty folder says what to do and still offers the add form", () => {
    render(view(locale, folderOf({ items: [] })));
    expect(screen.getByText(t.emptyItemsTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyItemsBody)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t.itemName })).toBeTruthy();
    expect(within(screen.getByRole("banner")).queryByRole("list")).toBeNull();
  });

  it("the add form offers only the viewer's enabled currencies, default first", () => {
    render(view(locale, folderOf({ items: [item(1, "Imported", "EUR", 2, 100)] })));
    const select = screen.getByRole("combobox", { name: t.currency }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["USD", "LBP"]);
    expect(select.value).toBe("USD");
  });

  it("Enter adds the row at once with a client id and the currency's decimals, then clears and refocuses the name", async () => {
    let finish!: (value: { ok: true; createdAt: string; updatedAt: string }) => void;
    mocks.addItem.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(view(locale, folderOf()));
    const name = screen.getByRole("textbox", { name: t.itemName }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  Monitor " } });
    fireEvent.change(screen.getByRole("textbox", { name: t.price }), { target: { value: "199.99" } });
    await act(async () => { fireEvent.submit(name.form!); });

    expect(mocks.addItem).toHaveBeenCalledTimes(1);
    const sent = mocks.addItem.mock.calls[0][0];
    expect(sent).toMatchObject({ folderId: FOLDER, name: "Monitor", currency: "USD", decimalPlaces: 2, priceMinor: 19_999, expectedUnits: { USD: 2 } });
    expect(sent.id).toMatch(UUID);
    const first = within(list()).getAllByRole("listitem")[0];
    expect(first.textContent).toContain("Monitor");
    expect(first.textContent).toContain("$199.99");
    expect(screen.getByRole("banner").textContent).toContain("$999.99");
    expect(name.value).toBe("");
    expect(document.activeElement).toBe(name);

    const now = serverNow();
    await act(async () => { finish({ ok: true, createdAt: now, updatedAt: now }); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(list()).getAllByRole("listitem")[0].textContent).toContain("Monitor");
  });

  it("remembers the chosen currency and saves zero-decimal rows with 0 places", async () => {
    render(view(locale, folderOf()));
    const select = screen.getByRole("combobox", { name: t.currency }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "LBP" } });
    const name = screen.getByRole("textbox", { name: t.itemName }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Thermal paste" } });
    fireEvent.change(screen.getByRole("textbox", { name: t.price }), { target: { value: "450000" } });
    await act(async () => { fireEvent.submit(name.form!); });
    expect(mocks.addItem.mock.calls[0][0]).toMatchObject({ currency: "LBP", decimalPlaces: 0, priceMinor: 450_000 });
    expect(select.value).toBe("LBP");
    expect(screen.getByRole("banner").textContent).toContain("LBP 2,950,000");
  });

  it("on failure the text returns with the reason; the same id only while the text is unchanged", async () => {
    mocks.addItem.mockResolvedValue({ ok: false, error: "limitReached" });
    render(view(locale, folderOf()));
    const name = screen.getByRole("textbox", { name: t.itemName }) as HTMLInputElement;
    const price = screen.getByRole("textbox", { name: t.price }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Monitor" } });
    fireEvent.change(price, { target: { value: "199" } });
    await act(async () => { fireEvent.submit(name.form!); });

    expect(name.value).toBe("Monitor");
    expect(price.value).toBe("199");
    expect(screen.getByRole("alert").textContent).toBe(t.errorLimit);
    expect(screen.queryByText("Monitor", { selector: "bdi" })).toBeNull();

    await act(async () => { fireEvent.submit(name.form!); });
    const ids = () => mocks.addItem.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(ids()[1]).toBe(ids()[0]);

    fireEvent.change(name, { target: { value: "Monitor 27in" } });
    await act(async () => { fireEvent.submit(name.form!); });
    expect(ids()[2]).not.toBe(ids()[0]);
    expect(mocks.addItem.mock.calls[2][0].name).toBe("Monitor 27in");
  });

  it("after a conflict (the id is taken) even an unchanged retry gets a fresh id", async () => {
    mocks.addItem.mockResolvedValueOnce({ ok: false, error: "conflict" });
    render(view(locale, folderOf()));
    const name = screen.getByRole("textbox", { name: t.itemName }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Monitor" } });
    fireEvent.change(screen.getByRole("textbox", { name: t.price }), { target: { value: "199" } });
    await act(async () => { fireEvent.submit(name.form!); });
    expect(name.value).toBe("Monitor");
    await act(async () => { fireEvent.submit(name.form!); });
    const ids = mocks.addItem.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it("anyone can edit anyone's row, including someone else's", async () => {
    render(view(locale, folderOf({ isOwner: false, members: [person(KARIM, "Karim", true), person(VIEWER, "Dana")], items: [item(1, "Sofa", "USD", 2, 38_000, KARIM)] })));
    openRow("Sofa");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    fireEvent.change(within(dialog).getByRole("textbox", { name: t.price }), { target: { value: "400" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveItem })); });
    expect(mocks.updateItem).toHaveBeenCalledWith(item(1, "Sofa", "USD", 2, 0).id, { name: "Sofa", priceMinor: 40_000, quantity: 1 });
    expect(mocks.toast).toHaveBeenCalledWith(t.itemSaved);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rowOf("Sofa").textContent).toContain("$400.00");
  });

  it("edits a row priced in a currency the editor has not enabled with its stored decimals, and can move it to an enabled one", async () => {
    render(view(locale, folderOf({ items: [item(1, "Imported", "EUR", 2, 12_345)] })));
    openRow("Imported");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    const price = within(dialog).getByRole("textbox", { name: t.price }) as HTMLInputElement;
    expect(price.value).toBe("123.45");
    const select = within(dialog).getByRole("combobox", { name: t.currency }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["EUR", "USD", "LBP"]);
    fireEvent.change(price, { target: { value: "150.5" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveItem })); });
    expect(mocks.updateItem).toHaveBeenLastCalledWith(item(1, "", "EUR", 2, 0).id, { name: "Imported", priceMinor: 15_050, quantity: 1 });

    openRow("Imported");
    const again = await screen.findByRole("dialog", { name: t.editTitle });
    fireEvent.change(within(again).getByRole("combobox", { name: t.currency }), { target: { value: "LBP" } });
    fireEvent.change(within(again).getByRole("textbox", { name: t.price }), { target: { value: "90000" } });
    await act(async () => { fireEvent.click(within(again).getByRole("button", { name: t.saveItem })); });
    expect(mocks.updateItem).toHaveBeenLastCalledWith(item(1, "", "EUR", 2, 0).id, { name: "Imported", priceMinor: 90_000, quantity: 1, currency: "LBP", decimalPlaces: 0 });
    expect(rowOf("Imported").textContent).toContain("LBP 90,000");
  });

  it("saving a row someone else removed says so, drops it and closes the sheet", async () => {
    mocks.updateItem.mockResolvedValue({ ok: false, error: "conflict" });
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveItem })); });
    expect(mocks.toast.error).toHaveBeenCalledWith(t.itemRemoved);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("GPU", { selector: "bdi" })).toBeNull();
    expect(screen.getByRole("banner").textContent).toContain("$350.00");
  });

  it("other save errors stay in the sheet with the reason", async () => {
    mocks.updateItem.mockResolvedValue({ ok: false, error: "notConfigured" });
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveItem })); });
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(t.errorPreview);
    expect(rowOf("GPU").textContent).toContain("$450.00");
  });

  it("deleting a row shows an Undo toast that restores it", async () => {
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
    const id = item(2, "", "USD", 2, 0).id;
    expect(mocks.deleteItem).toHaveBeenCalledWith(id);
    expect(screen.queryByText("GPU", { selector: "bdi" })).toBeNull();
    expect(screen.getByRole("banner").textContent).toContain("$350.00");
    expect(mocks.toast).toHaveBeenCalledWith(t.itemDeleted, expect.objectContaining({ action: expect.objectContaining({ label: t.undo }) }));
    // The server keeps the row for 10 minutes: the Undo stays up long enough to use.
    const { duration } = mocks.toast.mock.calls.at(-1)![1] as { duration: number };
    expect(duration).toBeGreaterThanOrEqual(8_000);
    expect(duration).toBeLessThanOrEqual(10_000);

    const undo = mocks.toast.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => { undo(); });
    expect(mocks.restoreItem).toHaveBeenCalledWith(id);
    expect(rowOf("GPU").textContent).toContain("$450.00");
    expect(within(list()).getAllByRole("listitem").map((row) => row.querySelector("bdi:not([dir])")?.textContent)).toEqual(["Fans", "Cables", "Case", "GPU", "CPU"]);
  });

  it("an Undo that is too late says to add the item again and keeps it out of the list", async () => {
    mocks.restoreItem.mockResolvedValue({ ok: false, error: "conflict" });
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
    const undo = mocks.toast.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => { undo(); });
    expect(mocks.toast.error).toHaveBeenCalledWith(t.undoExpired);
    expect(screen.queryByText("GPU", { selector: "bdi" })).toBeNull();
  });

  it.each(["failed", "notConfigured", "linkInvalid", "limitReached"] as const)("an Undo that fails with %s also says it cannot be undone", async (error) => {
    mocks.restoreItem.mockResolvedValue({ ok: false, error });
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
    const undo = mocks.toast.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => { undo(); });
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith(t.undoExpired);
    expect(screen.queryByText("GPU", { selector: "bdi" })).toBeNull();
  });

  it("an Undo takes the row's place from the server's times, not the row it deleted", async () => {
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
    mocks.restoreItem.mockResolvedValue({ ok: true, createdAt: "2026-11-09T12:30:00.000000+00:00", updatedAt: "2026-11-09T12:30:00.000000+00:00" });
    const undo = mocks.toast.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => { undo(); });
    expect(within(list()).getAllByRole("listitem").map((row) => row.querySelector("bdi:not([dir])")?.textContent)).toEqual(["GPU", "Fans", "Cables", "Case", "CPU"]);
  });

  it("deleting a row leaves focus on the add form's name field, not on the page", async () => {
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: t.itemName }));
  });

  it("a failed delete puts the row back with the reason", async () => {
    mocks.deleteItem.mockResolvedValue({ ok: false, error: "failed" });
    render(view(locale, folderOf()));
    openRow("GPU");
    const dialog = await screen.findByRole("dialog", { name: t.editTitle });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
    expect(mocks.toast.error).toHaveBeenCalledWith(t.errorFailed);
    expect(rowOf("GPU")).toBeTruthy();
  });

  it("shows who added each row only when more than one person is in the folder", () => {
    render(view(locale, folderOf({
      isOwner: false,
      members: [person(KARIM, "Karim", true), person(VIEWER, "Dana"), person(LINA, "Lina")],
      items: [item(4, "Mine", "USD", 2, 100, VIEWER), item(3, "Karim's", "USD", 2, 100, KARIM), item(2, "Gone", "USD", 2, 100, GONE), item(1, "Deleted account", "USD", 2, 100, null)],
    })));
    expect(rowOf("Mine").textContent).toContain(t.addedByYou);
    expect(rowOf("Karim's").textContent).toContain("Karim");
    expect(screen.getByText("Karim", { selector: "bdi" })).toBeTruthy();
    expect(rowOf("Gone").textContent).toContain(t.formerMember);
    expect(rowOf("Deleted account").textContent).toContain(t.formerMember);
  });

  it("hides who added when the viewer is the only active person, even with removed people listed", () => {
    render(view(locale, folderOf({ members: [person(VIEWER, "Bilal", true), person(GONE, "Sam", false, true)], items: [item(2, "Mine", "USD", 2, 100), item(1, "Theirs", "USD", 2, 100, GONE)] })));
    expect(rowOf("Mine").textContent).not.toContain(t.addedByYou);
    expect(rowOf("Theirs").textContent).not.toContain(t.formerMember);
    expect(rowOf("Theirs").textContent).not.toContain("Sam");
  });

  it("only the owner can rename and delete the folder", () => {
    render(view(locale, folderOf({ isOwner: false, members: [person(KARIM, "Karim", true), person(VIEWER, "Dana")] })));
    expect(screen.queryByRole("button", { name: t.renameFolder })).toBeNull();
    expect(screen.queryByRole("button", { name: t.deleteFolder })).toBeNull();
    cleanup();
    render(view(locale, folderOf()));
    expect(screen.getByRole("button", { name: t.renameFolder })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.deleteFolder })).toBeTruthy();
  });

  it("everyone gets a Share button in the header that opens the sharing sheet", () => {
    render(view(locale, folderOf({ isOwner: false, members: [person(KARIM, "Karim", true), person(VIEWER, "Dana")] })));
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: t.share }));
    expect(screen.getByRole("dialog", { name: t.shareTitle })).toBeTruthy();
    cleanup();
    render(view(locale, folderOf()));
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: t.share }));
    expect(screen.getByRole("dialog", { name: t.shareTitle })).toBeTruthy();
  });

  it("the owner renames the folder from a sheet", async () => {
    render(view(locale, folderOf()));
    fireEvent.click(screen.getByRole("button", { name: t.renameFolder }));
    const dialog = await screen.findByRole("dialog", { name: t.renameTitle });
    const field = within(dialog).getByRole("textbox", { name: t.folderName }) as HTMLInputElement;
    expect(field.value).toBe("PC build");
    fireEvent.change(field, { target: { value: " Gaming PC " } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveName })); });
    expect(mocks.renameFolder).toHaveBeenCalledWith(FOLDER, { name: "Gaming PC" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Gaming PC");
  });

  it("deleting the folder confirms that its rows go too, then returns to the list", async () => {
    render(view(locale, folderOf()));
    fireEvent.click(screen.getByRole("button", { name: t.deleteFolder }));
    const dialog = await screen.findByRole("dialog", { name: t.confirmDeleteFolder });
    expect(dialog.textContent).toContain(t.deleteFolderHelp);
    expect(mocks.deleteFolder).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteFolder })); });
    expect(mocks.deleteFolder).toHaveBeenCalledWith(FOLDER);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/invoices"));
    // The list is refreshed after leaving (the action itself does not re-render the folder page, which is gone).
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("a failed folder delete stays open with the reason", async () => {
    mocks.deleteFolder.mockResolvedValue({ ok: false, error: "conflict" });
    render(view(locale, folderOf()));
    fireEvent.click(screen.getByRole("button", { name: t.deleteFolder }));
    const dialog = await screen.findByRole("dialog", { name: t.confirmDeleteFolder });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteFolder })); });
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(t.errorConflict);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  describe("selection", () => {
    const pick = (name: string) => screen.getByRole("checkbox", { name: t.selectRow.replace("{name}", name) }) as HTMLInputElement;
    const tick = (name: string) => fireEvent.click(pick(name));
    const selectedLabel = (count: number) => t.selectedLabel.replace("{count}", String(count));
    const header = () => screen.getByRole("banner");
    const headerLines = () => within(within(header()).getByRole("list", { name: t.selectedTotalsLabel })).getAllByRole("listitem").map((line) => line.textContent);
    const bar = () => screen.queryByRole("region", { name: t.selectionBarLabel });
    const barLines = () => within(within(bar()!).getByRole("list", { name: t.selectedTotalsLabel })).getAllByRole("listitem").map((line) => line.textContent);
    const channel = () => mocks.realtime!.active()[0];
    const shared = () => folderOf({ isOwner: false, members: [person(KARIM, "Karim", true), person(VIEWER, "Dana")] });
    const idOf = (n: number) => item(n, "", "USD", 2, 0).id;

    it("every row has its own checkbox, unticked, and the header says nothing is selected", () => {
      render(view(locale, folderOf()));
      expect(screen.getAllByRole("checkbox")).toHaveLength(5);
      expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
      expect(within(header()).getByText(selectedLabel(0))).toBeTruthy();
      expect(within(header()).queryByRole("list", { name: t.selectedTotalsLabel })).toBeNull();
      expect(bar()).toBeNull();
    });

    it("ticking a USD row and an LBP row shows two separate selected totals, never one number", () => {
      render(view(locale, folderOf()));
      tick("GPU"); tick("Fans");
      expect(within(header()).getByText(selectedLabel(2))).toBeTruthy();
      expect(headerLines()).toEqual(["$450.00", "LBP 1,000,000"]);
      expect(header().textContent).not.toMatch(/1,000,450|1,000,000450/);
      expect(within(header()).getByRole("list", { name: t.selectedTotalsLabel }).querySelectorAll('bdi[dir="ltr"]')).toHaveLength(2);
      // The folder's own totals are untouched.
      expect(within(within(header()).getByRole("list", { name: t.totalsLabel })).getAllByRole("listitem").map((line) => line.textContent)).toEqual(["$800.00", "LBP 2,500,000"]);
    });

    it("sums only the ticked rows of one currency, and follows the totals' currency order", () => {
      render(view(locale, folderOf()));
      tick("Fans"); tick("Cables"); tick("CPU"); tick("GPU");
      expect(headerLines()).toEqual(["$700.00", "LBP 2,500,000"]);
      tick("GPU");
      expect(headerLines()).toEqual(["$250.00", "LBP 2,500,000"]);
      tick("CPU");
      expect(headerLines()).toEqual(["LBP 2,500,000"]);
    });

    it("a ticked row is tinted, and unticking restores it", () => {
      render(view(locale, folderOf()));
      tick("GPU");
      expect(rowOf("GPU").className).toContain("bg-secondary");
      expect(rowOf("CPU").className).not.toContain("bg-secondary");
      tick("GPU");
      expect(rowOf("GPU").className).not.toContain("bg-secondary");
    });

    it("the checkbox sits in its own 48px column, apart from the row's edit button", () => {
      render(view(locale, folderOf()));
      const box = pick("GPU");
      expect(box.className).toContain("size-5");
      expect(box.className).toContain("accent-primary");
      expect(box.closest("label")!.className).toContain("w-12");
      expect(within(rowOf("GPU")).getByRole("button").contains(box)).toBe(false);
    });

    it("ticking does not open the edit sheet; tapping the rest of the row still does", async () => {
      render(view(locale, folderOf()));
      tick("GPU");
      expect(screen.queryByRole("dialog")).toBeNull();
      openRow("GPU");
      expect(await screen.findByRole("dialog", { name: t.editTitle })).toBeTruthy();
    });

    it("Select all ticks every row and becomes Clear; Clear unticks them", () => {
      render(view(locale, folderOf()));
      fireEvent.click(screen.getByRole("button", { name: t.selectAll }));
      expect(screen.getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true);
      expect(within(header()).getByText(selectedLabel(5))).toBeTruthy();
      expect(headerLines()).toEqual(["$800.00", "LBP 2,500,000"]);
      expect(screen.queryByRole("button", { name: t.selectAll })).toBeNull();
      fireEvent.click(screen.getAllByRole("button", { name: t.clearSelection })[0]);
      expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
      expect(within(header()).getByText(selectedLabel(0))).toBeTruthy();
      expect(screen.getByRole("button", { name: t.selectAll })).toBeTruthy();
    });

    it("with some rows ticked the button still says Select all and completes the selection", () => {
      render(view(locale, folderOf()));
      tick("GPU");
      fireEvent.click(screen.getByRole("button", { name: t.selectAll }));
      expect(within(header()).getByText(selectedLabel(5))).toBeTruthy();
    });

    it("an empty folder has no Select all button", () => {
      render(view(locale, folderOf({ items: [] })));
      expect(screen.queryByRole("button", { name: t.selectAll })).toBeNull();
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("the sticky bar appears with the count and per-currency totals, and its X clears the selection", () => {
      render(view(locale, folderOf()));
      expect(bar()).toBeNull();
      tick("CPU"); tick("Cables");
      expect(bar()).not.toBeNull();
      expect(within(bar()!).getByText(selectedLabel(2))).toBeTruthy();
      expect(barLines()).toEqual(["$250.00", "LBP 1,500,000"]);
      expect(bar()!.className).toContain("sticky");
      fireEvent.click(within(bar()!).getByRole("button", { name: t.clearSelection }));
      expect(bar()).toBeNull();
      expect(pick("CPU").checked).toBe(false);
      expect(within(header()).getByText(selectedLabel(0))).toBeTruthy();
    });

    it("unticking the last row removes the bar", () => {
      render(view(locale, folderOf()));
      tick("CPU");
      expect(bar()).not.toBeNull();
      tick("CPU");
      expect(bar()).toBeNull();
    });

    it("the header does not change height when ticking: the line is reserved for every currency", () => {
      render(view(locale, folderOf()));
      const reserved = (within(header()).getByText(selectedLabel(0)).parentElement as HTMLElement).style.minHeight;
      expect(reserved).not.toBe("");
      tick("GPU");
      expect((within(header()).getByText(selectedLabel(1)).parentElement as HTMLElement).style.minHeight).toBe(reserved);
    });

    it("a ticked row in a currency the viewer lacks shows its own code and stored decimals in the selected total", () => {
      render(view(locale, folderOf({ items: [item(2, "Imported", "EUR", 2, 12_345), item(1, "Old", "SYP", 0, 5000), item(3, "Case", "USD", 2, 10_000)] })));
      tick("Imported"); tick("Old");
      expect(headerLines()).toEqual(["EUR 123.45", "SYP 5,000"]);
      expect(barLines()).toEqual(["EUR 123.45", "SYP 5,000"]);
    });

    it("a selected total that cannot be summed says it is too large to show, without hiding the others", () => {
      render(view(locale, folderOf({ items: [item(2, "A", "USD", 2, MAX_MINOR), item(1, "B", "USD", 2, MAX_MINOR), item(3, "C", "LBP", 0, 100)] })));
      tick("A");
      expect(headerLines()[0]).toMatch(/^\$/);
      tick("B"); tick("C");
      const lines = headerLines();
      expect(lines[0]).toBe(t.totalTooLarge.replace("<bdi>{currency}</bdi>", "USD"));
      expect(lines[1]).toBe("LBP 100");
      expect(barLines()[0]).toContain("USD:");
    });

    it("a row that is still saving cannot be ticked, like the rest of its row", async () => {
      let finish!: (value: { ok: true; createdAt: string; updatedAt: string }) => void;
      mocks.addItem.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      render(view(locale, folderOf()));
      const name = screen.getByRole("textbox", { name: t.itemName }) as HTMLInputElement;
      fireEvent.change(name, { target: { value: "Monitor" } });
      fireEvent.change(screen.getByRole("textbox", { name: t.price }), { target: { value: "199.99" } });
      await act(async () => { fireEvent.submit(name.form!); });
      expect(pick("Monitor").disabled).toBe(true);
      expect(within(rowOf("Monitor")).queryByRole("button")).toBeNull();
      // Select all leaves it out until it is saved.
      fireEvent.click(screen.getByRole("button", { name: t.selectAll }));
      expect(within(header()).getByText(selectedLabel(5))).toBeTruthy();
      expect(pick("Monitor").checked).toBe(false);
      expect(screen.queryByRole("button", { name: t.selectAll })).toBeNull();
      const now = serverNow();
      await act(async () => { finish({ ok: true, createdAt: now, updatedAt: now }); });
      expect(pick("Monitor").disabled).toBe(false);
      expect(screen.getByRole("button", { name: t.selectAll })).toBeTruthy();
    });

    it("selects rows added by anyone, including someone else's arriving live", async () => {
      render(view(locale, shared()));
      await act(async () => {});
      act(() => channel().emit("invoice_items", { eventType: "INSERT", old: {}, new: {
        id: idOf(6), folder_id: FOLDER, category_id: OTHER, name: "Monitor", currency: "USD", decimal_places: 2, price_minor: 20_000, quantity: 1,
        created_by: KARIM, updated_by: KARIM, created_at: item(6, "", "USD", 2, 0).createdAt, updated_at: item(6, "", "USD", 2, 0).updatedAt } }));
      tick("Monitor");
      expect(headerLines()).toEqual(["$200.00"]);
    });

    it("selection survives an edit of the ticked row, and the selected total follows the new price", async () => {
      render(view(locale, folderOf()));
      tick("GPU");
      openRow("GPU");
      const dialog = await screen.findByRole("dialog", { name: t.editTitle });
      fireEvent.change(within(dialog).getByRole("textbox", { name: t.price }), { target: { value: "400" } });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveItem })); });
      expect(pick("GPU").checked).toBe(true);
      expect(headerLines()).toEqual(["$400.00"]);
    });

    it("a row deleted here leaves the selection, and Undo brings it back unticked", async () => {
      render(view(locale, folderOf()));
      tick("GPU"); tick("CPU");
      openRow("GPU");
      const dialog = await screen.findByRole("dialog", { name: t.editTitle });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
      expect(within(header()).getByText(selectedLabel(1))).toBeTruthy();
      expect(headerLines()).toEqual(["$250.00"]);
      const undo = mocks.toast.mock.calls.at(-1)![1].action.onClick as () => void;
      await act(async () => { undo(); });
      expect(rowOf("GPU")).toBeTruthy();
      expect(pick("GPU").checked).toBe(false);
      expect(pick("CPU").checked).toBe(true);
      expect(within(header()).getByText(selectedLabel(1))).toBeTruthy();
      expect(headerLines()).toEqual(["$250.00"]);
    });

    it("deleting the only ticked row clears the bar", async () => {
      render(view(locale, folderOf()));
      tick("GPU");
      openRow("GPU");
      const dialog = await screen.findByRole("dialog", { name: t.editTitle });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteItem })); });
      expect(bar()).toBeNull();
      expect(within(header()).getByText(selectedLabel(0))).toBeTruthy();
    });

    it("a row deleted by someone else leaves the selection, and does not return ticked if it comes back", async () => {
      render(view(locale, shared()));
      await act(async () => {});
      tick("GPU"); tick("Case");
      act(() => channel().emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: idOf(2) } }));
      expect(screen.queryByText("GPU", { selector: "bdi" })).toBeNull();
      expect(within(header()).getByText(selectedLabel(1))).toBeTruthy();
      expect(headerLines()).toEqual(["$100.00"]);
      // Someone's Undo brings it back later.
      act(() => channel().emit("invoice_items", { eventType: "INSERT", old: {}, new: {
        id: idOf(2), folder_id: FOLDER, category_id: OTHER, name: "GPU", currency: "USD", decimal_places: 2, price_minor: 45_000, quantity: 1,
        created_by: KARIM, updated_by: KARIM, created_at: item(2, "", "USD", 2, 0).createdAt, updated_at: "2026-11-09T12:00:00Z" } }));
      expect(pick("GPU").checked).toBe(false);
      expect(within(header()).getByText(selectedLabel(1))).toBeTruthy();
    });

    it("a row missing from a refreshed page leaves the selection", () => {
      const { rerender } = render(view(locale, shared()));
      tick("GPU"); tick("CPU");
      rerender(view(locale, { ...shared(), items: pcItems.filter((row) => row.name !== "GPU") }));
      expect(within(header()).getByText(selectedLabel(1))).toBeTruthy();
      rerender(view(locale, { ...shared(), items: pcItems }));
      expect(pick("GPU").checked).toBe(false);
      expect(pick("CPU").checked).toBe(true);
    });
  });

  describe("categories", () => {
    const CASE_ID = "1c000000-0000-4000-8000-000000000002";
    const caseCategory: InvoiceCategory = { id: CASE_ID, folderId: FOLDER, name: "Case & Cooling", isDefault: false, createdAt: "2026-11-02T00:00:00Z" };
    const sorted = () => folderOf({
      categories: [caseCategory, otherCategory],
      items: [{ ...item(3, "Case", "USD", 2, 10_000), categoryId: CASE_ID }, item(2, "GPU", "USD", 2, 45_000)],
    });

    it("shows rows under their category with a subtotal, custom categories first and \"Other\" last", () => {
      render(view(locale, sorted()));
      const t = catalogsT();
      const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
      expect(headings).toEqual(["Case & Cooling(1)", `${t.categoryOther}(1)`]);
      const group = screen.getByRole("list", { name: "Case & Cooling" });
      expect(within(group).getByText("Case", { selector: "bdi" })).toBeTruthy();
      expect(within(screen.getByRole("list", { name: t.categoryTotalsLabel.replace("{name}", "Case & Cooling") })).getByText(/100\.00/)).toBeTruthy();
    });

    it("shows no headings while the folder only has \"Other\"", () => {
      render(view(locale, folderOf()));
      expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
    });

    it("starts with every category open, and a category can be closed and opened again", () => {
      render(view(locale, sorted()));
      const toggles = screen.getAllByRole("button", { expanded: true });
      expect(toggles.map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
      const caseToggle = screen.getByRole("button", { name: /^Case & Cooling/ });
      fireEvent.click(caseToggle);
      expect(caseToggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("list", { name: "Case & Cooling" })).toBeNull(); // hidden from the accessibility tree
      expect(screen.getByText("GPU", { selector: "bdi" })).toBeTruthy(); // the other group is untouched
      fireEvent.click(caseToggle);
      expect(caseToggle.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("list", { name: "Case & Cooling" })).toBeTruthy();
    });

    it("selects every row of one category with its own button, and clears just that category again", () => {
      const t = catalogsT();
      render(view(locale, folderOf({
        categories: [caseCategory, otherCategory],
        items: [{ ...item(4, "Fan", "USD", 2, 2_000), categoryId: CASE_ID }, { ...item(3, "Case", "USD", 2, 10_000), categoryId: CASE_ID }, item(2, "GPU", "USD", 2, 45_000)],
      })));
      const selectCase = () => screen.getByRole("button", { name: t.selectCategory.replace("{name}", "Case & Cooling") });
      fireEvent.click(selectCase());
      const checkbox = (name: string) => within(rowOf(name)).getByRole("checkbox") as HTMLInputElement;
      expect([checkbox("Fan").checked, checkbox("Case").checked, checkbox("GPU").checked]).toEqual([true, true, false]);
      expect(screen.getByRole("region", { name: t.selectionBarLabel }).textContent).toContain("120.00");
      // Every row of the category is ticked, so its button now clears them; the other category stays as it was.
      fireEvent.click(checkbox("GPU"));
      fireEvent.click(screen.getByRole("button", { name: t.clearCategory.replace("{name}", "Case & Cooling") }));
      expect([checkbox("Fan").checked, checkbox("Case").checked, checkbox("GPU").checked]).toEqual([false, false, true]);
      // A partly ticked category selects the rest, not nothing.
      fireEvent.click(checkbox("Fan"));
      fireEvent.click(selectCase());
      expect([checkbox("Fan").checked, checkbox("Case").checked]).toEqual([true, true]);
    });

    it("puts a row of a category this screen does not know under \"Other\"", () => {
      render(view(locale, folderOf({ categories: [caseCategory, otherCategory], items: [{ ...item(3, "Case", "USD", 2, 10_000), categoryId: "1c000000-0000-4000-8000-0000000000ff" }] })));
      expect(within(screen.getByRole("list", { name: catalogsT().categoryOther })).getByText("Case", { selector: "bdi" })).toBeTruthy();
    });
  });

  describe("quantity", () => {
    const t = () => catalogsT();
    const quantityField = (scope: { getByRole: typeof screen.getByRole } = screen) => scope.getByRole("textbox", { name: t().quantity }) as HTMLInputElement;

    it("starts at 1, and a row is added with the quantity typed, priced per unit", async () => {
      render(view(locale, folderOf()));
      expect(quantityField().value).toBe("1");
      const name = screen.getByRole("textbox", { name: t().itemName }) as HTMLTextAreaElement;
      fireEvent.change(name, { target: { value: "Fan" } });
      fireEvent.change(screen.getByRole("textbox", { name: t().price }), { target: { value: "5" } });
      fireEvent.change(quantityField(), { target: { value: "3" } });
      await act(async () => { fireEvent.submit(name.form!); });
      expect(mocks.addItem.mock.calls[0][0]).toMatchObject({ name: "Fan", priceMinor: 500, quantity: 3 });
      // The list shows the row's total, with "3 × unit price" under the name.
      const first = within(list()).getAllByRole("listitem")[0];
      expect(first.textContent).toContain("$15.00");
      expect(first.textContent).toContain("3 × $5.00");
      // The next row starts at 1 again.
      expect(quantityField().value).toBe("1");
    });

    it("shows the row total under the fields once more than one unit is entered", () => {
      render(view(locale, folderOf()));
      fireEvent.change(screen.getByRole("textbox", { name: t().price }), { target: { value: "5" } });
      expect(screen.queryByText(/\$5\.00/, { selector: "bdi" })).toBeNull(); // quantity 1: nothing to add up
      fireEvent.change(quantityField(), { target: { value: "4" } });
      expect(screen.getByText(/\$20\.00/, { selector: "bdi" })).toBeTruthy();
    });

    it("refuses 0, fractions, text and anything above 9999", async () => {
      render(view(locale, folderOf()));
      const name = screen.getByRole("textbox", { name: t().itemName }) as HTMLTextAreaElement;
      fireEvent.change(name, { target: { value: "Fan" } });
      fireEvent.change(screen.getByRole("textbox", { name: t().price }), { target: { value: "5" } });
      for (const bad of ["0", "1.5", "abc", "10000", ""]) {
        fireEvent.change(quantityField(), { target: { value: bad } });
        await act(async () => { fireEvent.submit(name.form!); });
        expect(mocks.addItem).not.toHaveBeenCalled();
      }
      fireEvent.change(quantityField(), { target: { value: "9999" } });
      await act(async () => { fireEvent.submit(name.form!); });
      expect(mocks.addItem).toHaveBeenCalledTimes(1);
    });

    it("counts price x quantity in the folder total, and a quantity of 1 shows no extra line", () => {
      const rows = [{ ...item(2, "Fans", "USD", 2, 500), quantity: 4 }, item(1, "Case", "USD", 2, 10_000)];
      render(view(locale, folderOf({ items: rows })));
      expect(screen.getByRole("banner").textContent).toContain("$120.00");
      expect(rowOf("Fans").textContent).toContain("4 × $5.00");
      expect(rowOf("Fans").textContent).toContain("$20.00");
      expect(rowOf("Case").textContent).not.toContain("×");
    });

    it("edits the quantity of a row, starting from the one it has", async () => {
      render(view(locale, folderOf({ items: [{ ...item(1, "Fans", "USD", 2, 500), quantity: 4 }] })));
      openRow("Fans");
      const dialog = await screen.findByRole("dialog", { name: t().editTitle });
      expect(quantityField(within(dialog)).value).toBe("4");
      fireEvent.change(quantityField(within(dialog)), { target: { value: "6" } });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t().saveItem })); });
      expect(mocks.updateItem).toHaveBeenCalledWith(item(1, "Fans", "USD", 2, 0).id, { name: "Fans", priceMinor: 500, quantity: 6 });
      expect(rowOf("Fans").textContent).toContain("6 × $5.00");
    });
  });

  describe("live updates", () => {
    const channel = () => mocks.realtime!.active()[0];
    const remoteRow = (n: number, name: string, priceMinor: number, createdBy = KARIM) => {
      const row = item(n, name, "USD", 2, priceMinor, createdBy);
      return { id: row.id, folder_id: FOLDER, category_id: OTHER, name, currency: "USD", decimal_places: 2, price_minor: priceMinor, quantity: 1,
        created_by: createdBy, updated_by: createdBy, created_at: row.createdAt, updated_at: row.updatedAt };
    };
    const shared = () => folderOf({ isOwner: false, members: [person(KARIM, "Karim", true), person(VIEWER, "Dana")] });

    it("someone else's new, edited and deleted rows appear without a reload, with totals", async () => {
      render(view(locale, shared()));
      await act(async () => {}); // the channel joins once the session token is set
      act(() => channel().emit("invoice_items", { eventType: "INSERT", new: remoteRow(6, "Monitor", 20_000), old: {} }));
      expect(within(list()).getAllByRole("listitem")[0].textContent).toContain("Monitor");
      expect(rowOf("Monitor").textContent).toContain("Karim");
      expect(screen.getByRole("banner").textContent).toContain("$1,000.00");
      act(() => channel().emit("invoice_items", { eventType: "UPDATE", new: { ...remoteRow(6, "Monitor 27in", 30_000), updated_at: "2026-11-09T12:00:00Z" }, old: { id: item(6, "", "USD", 2, 0).id } }));
      expect(rowOf("Monitor 27in").textContent).toContain("$300.00");
      act(() => channel().emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: item(6, "", "USD", 2, 0).id } }));
      expect(screen.queryByText("Monitor 27in", { selector: "bdi" })).toBeNull();
      expect(screen.getByRole("banner").textContent).toContain("$800.00");
    });

    it("the echo of the viewer's own add lands once and keeps the order", async () => {
      render(view(locale, folderOf()));
      await act(async () => {}); // the channel joins once the session token is set
      const name = screen.getByRole("textbox", { name: t.itemName }) as HTMLInputElement;
      fireEvent.change(name, { target: { value: "Monitor" } });
      fireEvent.change(screen.getByRole("textbox", { name: t.price }), { target: { value: "199.99" } });
      await act(async () => { fireEvent.submit(name.form!); });
      const sent = mocks.addItem.mock.calls[0][0] as { id: string };
      const added = within(list()).getAllByRole("listitem")[0];
      expect(added.textContent).toContain("Monitor");
      const createdAt = new Date().toISOString();
      for (let echo = 0; echo < 2; echo++) {
        act(() => channel().emit("invoice_items", { eventType: "INSERT", old: {}, new: {
          id: sent.id, folder_id: FOLDER, category_id: OTHER, name: "Monitor", currency: "USD", decimal_places: 2, price_minor: 19_999, quantity: 1,
          created_by: VIEWER, updated_by: VIEWER, created_at: createdAt, updated_at: createdAt } }));
      }
      const names = within(list()).getAllByRole("listitem").map((row) => row.querySelector("bdi:not([dir])")?.textContent);
      expect(names).toEqual(["Monitor", "Fans", "Cables", "Case", "GPU", "CPU"]);
    });

    it("a row deleted by someone else while it is being edited closes the sheet with a notice", async () => {
      render(view(locale, shared()));
      await act(async () => {}); // the channel joins once the session token is set
      openRow("GPU");
      await screen.findByRole("dialog", { name: t.editTitle });
      act(() => channel().emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: item(2, "", "USD", 2, 0).id } }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mocks.toast.error).toHaveBeenCalledWith(t.itemRemovedRemote);
      expect(screen.queryByText("GPU", { selector: "bdi" })).toBeNull();
    });

    it("a remote delete of a row nobody is editing, or of another folder's id, shows no notice", async () => {
      render(view(locale, shared()));
      await act(async () => {}); // the channel joins once the session token is set
      openRow("GPU");
      await screen.findByRole("dialog", { name: t.editTitle });
      act(() => channel().emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: item(3, "", "USD", 2, 0).id } }));
      act(() => channel().emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: "1d000000-0000-4000-8000-000000000077" } }));
      expect(screen.getByRole("dialog", { name: t.editTitle })).toBeTruthy();
      expect(mocks.toast.error).not.toHaveBeenCalled();
    });

    it("a remote delete that arrives while the edit is being saved gives one notice, not two", async () => {
      let answer!: (value: { ok: false; error: "conflict" }) => void;
      mocks.updateItem.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
      render(view(locale, shared()));
      await act(async () => {}); // the channel joins once the session token is set
      openRow("GPU");
      const dialog = await screen.findByRole("dialog", { name: t.editTitle });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveItem })); });
      act(() => channel().emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: item(2, "", "USD", 2, 0).id } }));
      await act(async () => { answer({ ok: false, error: "conflict" }); });
      expect(mocks.toast.error).toHaveBeenCalledTimes(1);
      expect(mocks.toast.error).toHaveBeenCalledWith(t.itemRemovedRemote);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("a save that finds the row gone with no remote notice still says so once", async () => {
      mocks.updateItem.mockResolvedValue({ ok: false, error: "conflict" });
      render(view(locale, shared()));
      await act(async () => {});
      openRow("GPU");
      const dialog = await screen.findByRole("dialog", { name: t.editTitle });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.saveItem })); });
      expect(mocks.toast.error).toHaveBeenCalledTimes(1);
      expect(mocks.toast.error).toHaveBeenCalledWith(t.itemRemoved);
    });

    it("an edit sheet whose row vanished from a refreshed page does not reopen when the row comes back", async () => {
      const { rerender } = render(view(locale, shared()));
      openRow("GPU");
      await screen.findByRole("dialog", { name: t.editTitle });
      const without = pcItems.filter((row) => row.name !== "GPU");
      rerender(view(locale, { ...shared(), items: without }));
      expect(screen.queryByRole("dialog")).toBeNull();
      // Someone's Undo brings the row back in a later page.
      rerender(view(locale, { ...shared(), items: pcItems }));
      expect(rowOf("GPU")).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("when the folder is deleted for everyone, no rows stay on screen and the list opens with a notice", async () => {
      render(view(locale, shared()));
      await act(async () => {}); // the channel joins once the session token is set
      act(() => channel().emit("invoice_folders", { eventType: "DELETE", new: {}, old: { id: FOLDER } }));
      expect(screen.queryByRole("list", { name: t.itemsLabel })).toBeNull();
      expect(screen.queryByText("GPU", { selector: "bdi" })).toBeNull();
      expect(screen.queryByRole("banner")).toBeNull();
      expect(mocks.replace).toHaveBeenCalledWith({ pathname: "/invoices", query: { unavailable: "1" } });
    });

    it("the owner deleting the folder goes to the list without the lost-access notice", async () => {
      let finish!: (value: { ok: true }) => void;
      mocks.deleteFolder.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      render(view(locale, folderOf()));
      await act(async () => {}); // the channel joins once the session token is set
      fireEvent.click(screen.getByRole("button", { name: t.deleteFolder }));
      const dialog = await screen.findByRole("dialog", { name: t.confirmDeleteFolder });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.deleteFolder })); });
      // The realtime delete can arrive before the action answers.
      act(() => channel().emit("invoice_folders", { eventType: "DELETE", new: {}, old: { id: FOLDER } }));
      await act(async () => { finish({ ok: true }); });
      expect(mocks.replace).not.toHaveBeenCalled();
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/invoices"));
    });
  });
});

describe("useFolderItems.applyRemote", () => {
  const a = item(1, "A", "USD", 2, 100);
  const b = item(3, "B", "USD", 2, 200);

  it("inserts an unknown row in newest-first order and replaces a known one", () => {
    const initial = [b, a];
    const { result } = renderHook(() => useFolderItems(initial));
    const middle = item(2, "Middle", "LBP", 0, 5);
    act(() => result.current.applyRemote({ type: "upsert", item: middle }));
    expect(result.current.items.map((row) => row.name)).toEqual(["B", "Middle", "A"]);
    act(() => result.current.applyRemote({ type: "upsert", item: { ...a, name: "A2", priceMinor: 999, updatedAt: "2026-11-09T12:00:00Z" } }));
    expect(result.current.items.map((row) => row.name)).toEqual(["B", "Middle", "A2"]);
    expect(new Set(result.current.items.map((row) => row.id)).size).toBe(3);
  });

  it("removes a known row and ignores a delete of an unknown id", () => {
    const initial = [b, a];
    const { result } = renderHook(() => useFolderItems(initial));
    act(() => result.current.applyRemote({ type: "delete", id: "1d000000-0000-4000-8000-000000000077" }));
    expect(result.current.items).toHaveLength(2);
    act(() => result.current.applyRemote({ type: "delete", id: b.id }));
    expect(result.current.items.map((row) => row.name)).toEqual(["A"]);
  });

  it("applying the same change twice changes nothing the second time", () => {
    const initial = [b, a];
    const { result } = renderHook(() => useFolderItems(initial));
    const middle = item(2, "Middle", "LBP", 0, 5);
    act(() => result.current.applyRemote({ type: "upsert", item: middle }));
    const once = result.current.items;
    act(() => result.current.applyRemote({ type: "upsert", item: middle }));
    expect(result.current.items.map((row) => row.id)).toEqual(once.map((row) => row.id));
  });
});

describe("useFolderItems snapshots", () => {
  const a = item(1, "A", "USD", 2, 100);
  const b = item(3, "B", "USD", 2, 200);
  const c = item(5, "C", "USD", 2, 300);
  const names = (rows: InvoiceItem[]) => rows.map((row) => row.name);

  it("a new array with the same rows keeps remote changes (no reset)", () => {
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [b, a] } });
    act(() => result.current.applyRemote({ type: "upsert", item: c }));
    rerender({ initial: [b, a] });
    expect(names(result.current.items)).toEqual(["C", "B", "A"]);
  });

  it("does not loop when the caller passes a new array on every render", () => {
    const { result } = renderHook(() => useFolderItems([item(3, "B", "USD", 2, 200), item(1, "A", "USD", 2, 100)]));
    act(() => result.current.applyRemote({ type: "delete", id: a.id }));
    expect(names(result.current.items)).toEqual(["B"]);
  });

  it("a stale snapshot (read before a remote change) keeps the remote change", () => {
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [b, a] } });
    const edited = { ...a, name: "A2", updatedAt: "2026-11-09T12:00:00Z" };
    act(() => {
      result.current.applyRemote({ type: "upsert", item: c });
      result.current.applyRemote({ type: "upsert", item: edited });
      result.current.applyRemote({ type: "delete", id: b.id });
    });
    // Someone else's unrelated edit lands in the snapshot, but the snapshot was read before our three changes.
    const other = item(2, "Other", "LBP", 0, 5);
    rerender({ initial: [b, other, a] });
    expect(names(result.current.items)).toEqual(["C", "Other", "A2"]);
  });

  it("a newer snapshot wins over an older remote change", () => {
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [b, a] } });
    act(() => result.current.applyRemote({ type: "upsert", item: { ...a, name: "A2", updatedAt: "2026-11-09T12:00:00Z" } }));
    rerender({ initial: [b, { ...a, name: "A3", updatedAt: "2026-11-09T13:00:00Z" }] });
    expect(names(result.current.items)).toEqual(["B", "A3"]);
  });

  it("a change the server never confirms stops applying after two newer snapshots", () => {
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [b, a] } });
    act(() => result.current.applyRemote({ type: "upsert", item: c }));
    rerender({ initial: [b, a, item(0, "Z", "USD", 2, 1)] });
    expect(names(result.current.items)).toContain("C");
    rerender({ initial: [b, a] });
    expect(names(result.current.items)).toEqual(["B", "A"]);
  });

  it("a delete for an id this folder never had is not kept", () => {
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [b, a] } });
    const stranger = "1d000000-0000-4000-8000-000000000077";
    act(() => result.current.applyRemote({ type: "delete", id: stranger }));
    // If it had been kept, the row with that id arriving in the next snapshot would be hidden.
    const arrived = { ...item(7, "Arrived", "USD", 2, 1), id: stranger };
    rerender({ initial: [arrived, b, a] });
    expect(names(result.current.items)).toEqual(["Arrived", "B", "A"]);
  });

  it("a failed add disappears even while another save is still pending", async () => {
    const { result } = renderHook(() => useFolderItems([b, a]));
    let fail!: (value: { ok: false; error: "failed" }) => void;
    let pass!: (value: { ok: true; createdAt: string; updatedAt: string }) => void;
    const x = item(6, "X", "USD", 2, 1);
    const y = item(7, "Y", "USD", 2, 1);
    await act(async () => {
      void result.current.add(x, () => new Promise((resolve) => { fail = resolve; }));
      void result.current.add(y, () => new Promise((resolve) => { pass = resolve; }));
    });
    expect(names(result.current.items)).toEqual(["Y", "X", "B", "A"]);
    await act(async () => { fail({ ok: false, error: "failed" }); });
    expect(names(result.current.items)).toEqual(["Y", "B", "A"]);
    await act(async () => { pass({ ok: true, createdAt: y.createdAt, updatedAt: y.updatedAt }); });
    expect(names(result.current.items)).toEqual(["Y", "B", "A"]);
  });
});

describe("useFolderItems never trusts the client's clock", () => {
  const names = (rows: InvoiceItem[]) => rows.map((row) => row.name);
  const a = item(1, "A", "USD", 2, 100);
  const b = item(3, "B", "USD", 2, 200);
  const r = { ...item(2, "R", "USD", 2, 100), createdAt: "2026-11-02T00:00:00.000000+00:00", updatedAt: "2026-11-09T10:00:00.000000+00:00" };
  /** The device clock runs 10 minutes ahead of the server (about 10:01 server time). */
  const skewClock = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-09T10:11:00Z")); };
  afterEach(() => { vi.useRealTimers(); });

  it("with Realtime down and the clock 10 minutes ahead, someone's later edit is not masked by the viewer's save", async () => {
    skewClock();
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [r] } });
    // The screen stamps the edit with its own (fast) clock; the server answers with its own.
    const mine = { ...r, name: "R by A", updatedAt: new Date().toISOString() };
    await act(async () => { await result.current.update(mine, async () => ({ ok: true, createdAt: r.createdAt, updatedAt: "2026-11-09T10:01:00.000000+00:00" })); });
    expect(names(result.current.items)).toEqual(["R by A"]);
    expect(result.current.items[0].updatedAt).toBe("2026-11-09T10:01:00.000000+00:00");
    // B edits the same row afterwards; only a poll brings it.
    const theirs = { ...r, name: "R by B", updatedAt: "2026-11-09T10:02:00.000000+00:00" };
    rerender({ initial: [theirs] });
    expect(names(result.current.items)).toEqual(["R by B"]);
    for (let poll = 0; poll < 3; poll++) {
      rerender({ initial: [{ ...theirs }] });
      expect(names(result.current.items)).toEqual(["R by B"]);
    }
  });

  it("the echo of a save that arrives before the action answers is not overwritten by the answer", async () => {
    skewClock();
    const { result } = renderHook(() => useFolderItems([r]));
    let answer!: (value: { ok: true; createdAt: string; updatedAt: string }) => void;
    let pending!: Promise<unknown>;
    await act(async () => { pending = result.current.update({ ...r, name: "R2", updatedAt: new Date().toISOString() }, () => new Promise((resolve) => { answer = resolve; })); });
    const echo = { ...r, name: "R2", updatedAt: "2026-11-09T10:01:00.000000+00:00" };
    act(() => result.current.applyRemote({ type: "upsert", item: echo }));
    await act(async () => { answer({ ok: true, createdAt: r.createdAt, updatedAt: echo.updatedAt }); await pending; });
    expect(result.current.items).toEqual([echo]);
  });

  it("someone's later edit that arrives before the viewer's save answers is kept", async () => {
    const { result } = renderHook(() => useFolderItems([r]));
    let answer!: (value: { ok: true; createdAt: string; updatedAt: string }) => void;
    let pending!: Promise<unknown>;
    await act(async () => { pending = result.current.update({ ...r, name: "R2" }, () => new Promise((resolve) => { answer = resolve; })); });
    const echo = { ...r, name: "R2", updatedAt: "2026-11-09T10:01:00.000000+00:00" };
    const later = { ...r, name: "R3 by B", updatedAt: "2026-11-09T10:02:00.000000+00:00" };
    act(() => { result.current.applyRemote({ type: "upsert", item: echo }); result.current.applyRemote({ type: "upsert", item: later }); });
    await act(async () => { answer({ ok: true, createdAt: r.createdAt, updatedAt: echo.updatedAt }); await pending; });
    expect(result.current.items).toEqual([later]);
  });

  it("an older or unreadable change never replaces a newer one for the same row", () => {
    const { result } = renderHook(() => useFolderItems([r]));
    const newer = { ...r, name: "Newer", updatedAt: "2026-11-09T10:02:00.000000+00:00" };
    act(() => result.current.applyRemote({ type: "upsert", item: newer }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Older", updatedAt: "2026-11-09T10:01:00.000000+00:00" } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Same time", updatedAt: newer.updatedAt } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Garbled", updatedAt: "not a time" } }));
    expect(result.current.items).toEqual([newer]);
    // A delete still wins, and a restore after it comes back.
    act(() => result.current.applyRemote({ type: "delete", id: r.id }));
    expect(result.current.items).toEqual([]);
    act(() => result.current.applyRemote({ type: "upsert", item: r }));
    expect(result.current.items).toEqual([r]);
  });

  it("an Undo of a row that still carries the device clock is logged with the server's times, so a later server edit is not masked", async () => {
    skewClock();
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [b, a] } });
    const stamp = new Date().toISOString();
    const x = { ...item(6, "X", "USD", 2, 1), createdAt: stamp, updatedAt: stamp };
    let finishAdd!: (value: { ok: true; createdAt: string; updatedAt: string }) => void;
    await act(async () => { void result.current.add(x, () => new Promise((resolve) => { finishAdd = resolve; })); });
    // The echo of the add arrives before the action answers, so the row can be opened and deleted while the add is still pending.
    const server = "2026-11-09T10:00:30.000000+00:00";
    act(() => result.current.applyRemote({ type: "upsert", item: { ...x, createdAt: server, updatedAt: server } }));
    await act(async () => { await result.current.remove(x.id, async () => ({ ok: true })); });
    const restored = "2026-11-09T10:01:00.000000+00:00";
    await act(async () => { await result.current.restore(x, async () => ({ ok: true, createdAt: server, updatedAt: restored })); });
    await act(async () => { finishAdd({ ok: true, createdAt: server, updatedAt: server }); });
    // Someone edits X later (server time); only a poll brings it.
    const theirs = { ...x, name: "X by B", createdAt: server, updatedAt: "2026-11-09T10:02:00.000000+00:00" };
    rerender({ initial: [theirs, b, a] });
    const shown = result.current.items.find((row) => row.id === x.id)!;
    expect(shown.name).toBe("X by B");
    expect(shown.updatedAt).toBe(theirs.updatedAt);
  });

  it("an equal server time counts as shown: a retry that answers with another person's timestamp cannot mask their edit", async () => {
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [r] } });
    const theirTime = "2026-11-09T10:05:00.000000+00:00";
    // A saves "R by A"; the retry after a lost response comes back with B's timestamp.
    await act(async () => { await result.current.update({ ...r, name: "R by A" }, async () => ({ ok: true, createdAt: r.createdAt, updatedAt: theirTime })); });
    expect(names(result.current.items)).toEqual(["R by A"]);
    rerender({ initial: [{ ...r, name: "R by B", updatedAt: theirTime }] });
    expect(names(result.current.items)).toEqual(["R by B"]);
  });

  it("a saved add takes its place in the list from the server's createdAt, not the device clock", async () => {
    skewClock();
    const { result } = renderHook(() => useFolderItems([b, a]));
    const stamp = new Date().toISOString();
    const x = { ...item(6, "X", "USD", 2, 1), createdAt: stamp, updatedAt: stamp };
    const server = "2026-11-02T00:00:00.000000+00:00";
    await act(async () => { await result.current.add(x, async () => ({ ok: true, createdAt: server, updatedAt: server })); });
    expect(names(result.current.items)).toEqual(["B", "X", "A"]);
    expect(result.current.items[1]).toMatchObject({ createdAt: server, updatedAt: server });
  });
});

describe("useFolderItems compares server times to the microsecond", () => {
  const names = (rows: InvoiceItem[]) => rows.map((row) => row.name);
  const r = { ...item(2, "R", "USD", 2, 100), createdAt: "2026-11-02T00:00:00.000000+00:00", updatedAt: "2026-11-09T10:00:00.000000+00:00" };
  /** Two saves of one row less than a millisecond apart: PostgreSQL keeps the microseconds. */
  const older = "2026-11-09T10:00:01.000001+00:00";
  const newer = "2026-11-09T10:00:01.000002+00:00";

  it("a version one microsecond newer that arrives second is applied", () => {
    const { result } = renderHook(() => useFolderItems([r]));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Older", updatedAt: older } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Newer", updatedAt: newer } }));
    expect(names(result.current.items)).toEqual(["Newer"]);
  });

  it("a version one microsecond older that arrives second is ignored, and an equal one too", () => {
    const { result } = renderHook(() => useFolderItems([r]));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Newer", updatedAt: newer } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Older", updatedAt: older } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Same time", updatedAt: newer } }));
    expect(names(result.current.items)).toEqual(["Newer"]);
  });

  it("a snapshot one microsecond older does not hide a newer change, and one a microsecond newer wins", () => {
    const { result, rerender } = renderHook(({ initial }) => useFolderItems(initial), { initialProps: { initial: [r] } });
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Newer", updatedAt: newer } }));
    rerender({ initial: [{ ...r, name: "Stale snapshot", updatedAt: older }] });
    expect(names(result.current.items)).toEqual(["Newer"]);
    rerender({ initial: [{ ...r, name: "Fresh snapshot", updatedAt: "2026-11-09T10:00:01.000003+00:00" }] });
    expect(names(result.current.items)).toEqual(["Fresh snapshot"]);
  });

  it("the Z and +00:00 forms of one instant compare equal, whatever the number of digits", () => {
    const { result } = renderHook(() => useFolderItems([r]));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "First", updatedAt: "2026-11-09T10:00:01.100000+00:00" } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Same as Z", updatedAt: "2026-11-09T10:00:01.1Z" } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Same in UTC+2", updatedAt: "2026-11-09T12:00:01.100+02:00" } }));
    expect(names(result.current.items)).toEqual(["First"]);
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Later as Z", updatedAt: "2026-11-09T10:00:01.100001Z" } }));
    expect(names(result.current.items)).toEqual(["Later as Z"]);
  });

  it("a device-clock time with millisecond digits still compares correctly with server microseconds", () => {
    const { result } = renderHook(() => useFolderItems([r]));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Server", updatedAt: "2026-11-09T10:00:01.000999+00:00" } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Device", updatedAt: "2026-11-09T10:00:01.001Z" } }));
    expect(names(result.current.items)).toEqual(["Device"]);
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Server again", updatedAt: "2026-11-09T10:00:01.000999+00:00" } }));
    act(() => result.current.applyRemote({ type: "upsert", item: { ...r, name: "Garbled", updatedAt: "2026-11-09T10:00:01.5 nonsense" } }));
    expect(names(result.current.items)).toEqual(["Device"]);
  });
});
