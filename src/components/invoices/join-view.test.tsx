// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

const mocks = vi.hoisted(() => ({
  joinFolder: vi.fn(),
  replace: vi.fn(),
  redirect: vi.fn((target: unknown) => { throw Object.assign(new Error("NEXT_REDIRECT"), { target }); }),
  preview: vi.fn(),
  ownFolder: vi.fn(),
}));
vi.mock("@/features/invoices/actions", () => ({ joinFolder: mocks.joinFolder }));
vi.mock("@/features/invoices/queries", () => ({ previewInvoiceLink: mocks.preview, ownInvoiceFolderForLink: mocks.ownFolder }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useRouter: () => ({ replace: mocks.replace, refresh: vi.fn() }),
  redirect: mocks.redirect,
}));
vi.mock("@/components/shell/screen-header", () => ({
  ScreenHeader: ({ title, children }: { title?: string; children?: React.ReactNode }) => <header><h1>{title}</h1>{children}</header>,
}));
import { JoinView } from "./join-view";
import JoinInvoicePage from "@/app/[locale]/(app)/invoices/join/[token]/page";

const token = "ab".repeat(32);
const folder = "ac000000-0000-4000-8000-000000000001";
const catalogs = { en, ar } as const;
type Locale = keyof typeof catalogs;

const wrap = (locale: Locale, node: React.ReactNode) =>
  <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>{node}</NextIntlClientProvider>;

const nameField = (locale: Locale) => screen.getByRole("textbox", { name: catalogs[locale].Invoices.joinName });
const joinButton = (locale: Locale) => screen.getByRole("button", { name: catalogs[locale].Invoices.join });

beforeEach(() => {
  mocks.joinFolder.mockReset();
  mocks.replace.mockReset();
  mocks.redirect.mockClear();
  mocks.preview.mockReset();
  mocks.ownFolder.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe.each(["en", "ar"] as const)("%s", (locale) => {
  const t = catalogs[locale].Invoices;

  it("shows the folder name and asks for a name before anything changes", () => {
    render(wrap(locale, <JoinView token={token} folderName="Living room" />));
    const name = screen.getByText("Living room");
    expect(name.tagName).toBe("BDI");
    expect(nameField(locale)).toBeTruthy();
    expect(mocks.joinFolder).not.toHaveBeenCalled();
  });

  it("keeps Join disabled until a valid name is entered", () => {
    render(wrap(locale, <JoinView token={token} folderName="Living room" />));
    expect((joinButton(locale) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameField(locale), { target: { value: "   " } });
    expect((joinButton(locale) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameField(locale), { target: { value: "Karim" } });
    expect((joinButton(locale) as HTMLButtonElement).disabled).toBe(false);
  });

  it("joins once on a double press, then opens the folder", async () => {
    let finish!: (value: unknown) => void;
    mocks.joinFolder.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(wrap(locale, <JoinView token={token} folderName="Living room" />));
    fireEvent.change(nameField(locale), { target: { value: " Karim " } });
    fireEvent.click(joinButton(locale));
    fireEvent.click(joinButton(locale));
    fireEvent.submit(nameField(locale).closest("form")!);
    expect(mocks.joinFolder).toHaveBeenCalledTimes(1);
    expect(mocks.joinFolder).toHaveBeenCalledWith(token, "Karim");
    await act(async () => finish({ ok: true, folderId: folder }));
    expect(mocks.replace).toHaveBeenCalledWith(`/invoices/${folder}`);
  });

  it("shows the single generic message when the link stops working", async () => {
    mocks.joinFolder.mockResolvedValue({ ok: false, error: "linkInvalid" });
    render(wrap(locale, <JoinView token={token} folderName="Living room" />));
    fireEvent.change(nameField(locale), { target: { value: "Karim" } });
    await act(async () => { fireEvent.click(joinButton(locale)); });
    expect(screen.getByText(t.errorLink)).toBeTruthy();
    expect(screen.queryByText("Living room")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps the form and says what failed for any other error", async () => {
    mocks.joinFolder.mockResolvedValue({ ok: false, error: "failed" });
    render(wrap(locale, <JoinView token={token} folderName="Living room" />));
    fireEvent.change(nameField(locale), { target: { value: "Karim" } });
    await act(async () => { fireEvent.click(joinButton(locale)); });
    expect(screen.getByRole("alert").textContent).toBe(t.errorFailed);
    expect((joinButton(locale) as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the same generic message for a link that does not work", () => {
    render(wrap(locale, <JoinView token={token} folderName={null} />));
    expect(screen.getByText(t.errorLink)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each([token.replace("a", "c"), "not-a-token", "../../evil", "ab".repeat(31)])("the page shows the generic message for an unknown token (%s), not an error", async (value) => {
    mocks.preview.mockResolvedValue(null);
    const page = await JoinInvoicePage({ params: Promise.resolve({ locale, token: value }) });
    render(wrap(locale, page));
    expect(screen.getByText(t.errorLink)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

it("the page shows the folder name and the join form for a working link", async () => {
  mocks.preview.mockResolvedValue({ name: "Living room" });
  render(wrap("en", await JoinInvoicePage({ params: Promise.resolve({ locale: "en", token }) })));
  expect(screen.getByText("Living room")).toBeTruthy();
  expect(nameField("en")).toBeTruthy();
  expect(mocks.preview).toHaveBeenCalledWith(token);
});

it("the owner opening their own link goes straight to the folder", async () => {
  mocks.preview.mockResolvedValue({ name: "PC build" });
  mocks.ownFolder.mockResolvedValue(folder);
  await expect(JoinInvoicePage({ params: Promise.resolve({ locale: "ar", token }) })).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith({ href: `/invoices/${folder}`, locale: "ar" });
  expect(mocks.joinFolder).not.toHaveBeenCalled();
});
