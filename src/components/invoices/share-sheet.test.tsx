// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { InvoiceMember } from "@/features/invoices/schema";
import type { InvoiceFolderDetail } from "@/features/invoices/queries";

const mocks = vi.hoisted(() => ({
  createOrRotateLink: vi.fn(), disableLink: vi.fn(), removeMember: vi.fn(), leaveFolder: vi.fn(), setMyName: vi.fn(),
  push: vi.fn(), refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/features/invoices/actions", () => ({
  createOrRotateLink: mocks.createOrRotateLink, disableLink: mocks.disableLink, removeMember: mocks.removeMember,
  leaveFolder: mocks.leaveFolder, setMyName: mocks.setMyName,
}));
vi.mock("@/features/invoices/queries", () => ({}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/components/ui/sheet-shell", () => ({
  SheetShell: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
}));
import { ShareSheet } from "./share-sheet";

const catalogs = { en, ar } as const;
type Locale = keyof typeof catalogs;

const VIEWER = "1a000000-0000-4000-8000-000000000001";
const KARIM = "1a000000-0000-4000-8000-000000000002";
const LINA = "1a000000-0000-4000-8000-000000000003";
const GONE = "1a000000-0000-4000-8000-000000000009";
const FOLDER = "1f000000-0000-4000-8000-000000000001";
const TOKEN = "a".repeat(64);
const FRESH = "b".repeat(64);

const person = (userId: string, displayName: string | null, isOwner = false, removed = false, at = 1): InvoiceMember =>
  ({ userId, displayName, isOwner, joinedAt: `2026-11-0${at}T00:00:00Z`, removed });

const folderOf = (over: Partial<InvoiceFolderDetail> = {}): InvoiceFolderDetail => ({
  id: FOLDER, name: "PC build", isOwner: true, viewerId: VIEWER, link: null, items: [],
  members: [person(VIEWER, "Dana", true)], ...over,
});

const view = (locale: Locale, folder: InvoiceFolderDetail) => (
  <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
    <ShareSheet folder={folder} />
  </NextIntlClientProvider>
);

const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key]);

const setNavigator = (key: "clipboard" | "share", value: unknown) =>
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe.each(["en", "ar"] as const)("%s", (locale) => {
  const t = catalogs[locale].Invoices;
  const urlFor = (token: string) => `${window.location.origin}/${locale}/invoices/join/${token}`;
  const openSheet = () => {
    fireEvent.click(screen.getByRole("button", { name: t.share }));
    return screen.getByRole("dialog", { name: t.shareTitle });
  };

  beforeEach(() => {
    for (const fn of [mocks.createOrRotateLink, mocks.disableLink, mocks.removeMember, mocks.leaveFolder, mocks.setMyName]) fn.mockReset().mockResolvedValue({ ok: true });
    mocks.createOrRotateLink.mockResolvedValue({ ok: true, token: FRESH });
    for (const fn of [mocks.push, mocks.refresh, mocks.toast, mocks.toast.error, mocks.toast.success]) fn.mockReset();
    setNavigator("clipboard", undefined);
    setNavigator("share", undefined);
  });

  describe("the owner without a link", () => {
    it("is offered Create link, and the first time is asked for their own name (required, 1 to 30 characters)", async () => {
      render(view(locale, folderOf({ members: [person(VIEWER, null, true)] })));
      const dialog = openSheet();
      const create = within(dialog).getByRole("button", { name: t.createLink }) as HTMLButtonElement;
      const name = within(dialog).getByRole("textbox", { name: t.joinName }) as HTMLInputElement;
      expect(name.maxLength).toBe(30);
      expect(create.disabled).toBe(true);
      fireEvent.change(name, { target: { value: "   " } });
      expect(create.disabled).toBe(true);
      fireEvent.change(name, { target: { value: "  Dana " } });
      expect(create.disabled).toBe(false);

      await act(async () => { fireEvent.click(create); });
      expect(mocks.createOrRotateLink).toHaveBeenCalledTimes(1);
      expect(mocks.createOrRotateLink).toHaveBeenCalledWith(FOLDER, "Dana");
      expect(mocks.refresh).toHaveBeenCalled();
      // The link shows at once, without waiting for the refreshed folder; the name is not asked again.
      expect((within(dialog).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement).value).toBe(urlFor(FRESH));
      // The first-share prompt is gone; the name can still be changed in the ordinary name field, now holding it.
      expect((within(dialog).getByRole("textbox", { name: t.joinName }) as HTMLInputElement).value).toBe("Dana");
      expect((within(dialog).getByRole("textbox", { name: t.joinName }) as HTMLInputElement).required).toBe(false);
    });

    it("is not asked for a name again once their member row has one", async () => {
      render(view(locale, folderOf()));
      const dialog = openSheet();
      // No prompt before creating the link: the only name field is the ordinary one, already filled.
      expect((within(dialog).getByRole("textbox", { name: t.joinName }) as HTMLInputElement).value).toBe("Dana");
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.createLink })); });
      expect(mocks.createOrRotateLink).toHaveBeenCalledWith(FOLDER);
      expect((within(dialog).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement).value).toBe(urlFor(FRESH));
    });

    it("keeps the sheet and says why when creating fails, and the same press tries again", async () => {
      mocks.createOrRotateLink.mockResolvedValueOnce({ ok: false, error: "failed" });
      render(view(locale, folderOf()));
      const dialog = openSheet();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.createLink })); });
      expect(within(dialog).getByRole("alert").textContent).toBe(t.errorFailed);
      expect(within(dialog).queryByRole("textbox", { name: t.linkLabel })).toBeNull();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.createLink })); });
      expect(mocks.createOrRotateLink).toHaveBeenCalledTimes(2);
      expect(within(dialog).queryByRole("alert")).toBeNull();
      expect(within(dialog).getByRole("textbox", { name: t.linkLabel })).toBeTruthy();
    });

    it("in preview mode shows the preview message and does not crash", async () => {
      mocks.createOrRotateLink.mockResolvedValue({ ok: false, error: "notConfigured" });
      render(view(locale, folderOf()));
      const dialog = openSheet();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.createLink })); });
      expect(within(dialog).getByRole("alert").textContent).toBe(t.errorPreview);
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("a thrown request counts as a failed one", async () => {
      mocks.createOrRotateLink.mockRejectedValueOnce(new Error("offline"));
      render(view(locale, folderOf()));
      const dialog = openSheet();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.createLink })); });
      expect(within(dialog).getByRole("alert").textContent).toBe(t.errorFailed);
    });
  });

  describe("the owner with a link", () => {
    const withLink = () => folderOf({ link: TOKEN });

    it("shows the link in a read-only, left-to-right, selectable field", () => {
      render(view(locale, withLink()));
      const field = within(openSheet()).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement;
      expect(field.value).toBe(urlFor(TOKEN));
      expect(field.readOnly).toBe(true);
      expect(field.dir).toBe("ltr");
      expect(within(openSheet()).queryByRole("button", { name: t.createLink })).toBeNull();
    });

    it("Copy writes the link to the clipboard and confirms", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setNavigator("clipboard", { writeText });
      render(view(locale, withLink()));
      const dialog = openSheet();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.copyLink })); });
      expect(writeText).toHaveBeenCalledWith(urlFor(TOKEN));
      expect(mocks.toast).toHaveBeenCalledWith(t.linkCopied);
      // A toast can sit behind the open sheet, so the same words show inside it.
      expect(within(dialog).getAllByRole("status")[0].textContent).toBe(t.linkCopied);
    });

    it("Copy falls back to selecting the field when the clipboard is missing or refuses", async () => {
      render(view(locale, withLink()));
      const dialog = openSheet();
      const field = within(dialog).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement;
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.copyLink })); });
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
      expect(mocks.toast).toHaveBeenCalledWith(t.linkSelected);

      field.blur();
      setNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
      mocks.toast.mockReset();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.copyLink })); });
      expect(document.activeElement).toBe(field);
      expect(mocks.toast).toHaveBeenCalledWith(t.linkSelected);
      expect(mocks.toast).not.toHaveBeenCalledWith(t.linkCopied);
    });

    it("Share uses the device share sheet when there is one", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      setNavigator("share", share);
      render(view(locale, withLink()));
      const dialog = openSheet();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.shareLink })); });
      expect(share).toHaveBeenCalledTimes(1);
      expect(share.mock.calls[0][0]).toMatchObject({ url: urlFor(TOKEN) });
    });

    it("a dismissed device share sheet is not an error", async () => {
      setNavigator("share", vi.fn().mockRejectedValue(new DOMException("closed", "AbortError")));
      render(view(locale, withLink()));
      const dialog = openSheet();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.shareLink })); });
      expect(mocks.toast.error).not.toHaveBeenCalled();
      expect(within(dialog).queryByRole("alert")).toBeNull();
    });

    it("hides Share when the device has no share sheet", () => {
      render(view(locale, withLink()));
      expect(within(openSheet()).queryByRole("button", { name: t.shareLink })).toBeNull();
    });

    it("Replace link confirms first and says the old link stops working", async () => {
      render(view(locale, withLink()));
      const dialog = openSheet();
      fireEvent.click(within(dialog).getByRole("button", { name: t.replaceLink }));
      const confirm = screen.getByRole("dialog", { name: t.replaceTitle });
      expect(confirm.textContent).toContain(t.replaceHelp);
      expect(mocks.createOrRotateLink).not.toHaveBeenCalled();

      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.replaceConfirm })); });
      expect(mocks.createOrRotateLink).toHaveBeenCalledWith(FOLDER);
      expect(mocks.refresh).toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: t.replaceTitle })).toBeNull();
      expect((within(dialog).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement).value).toBe(urlFor(FRESH));
    });

    it("cancelling Replace changes nothing", () => {
      render(view(locale, withLink()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: t.replaceLink }));
      fireEvent.click(within(screen.getByRole("dialog", { name: t.replaceTitle })).getByRole("button", { name: t.keepLink }));
      expect(mocks.createOrRotateLink).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: t.replaceTitle })).toBeNull();
    });

    it("Turn off link confirms, says people already in stay, and then offers Create link again", async () => {
      render(view(locale, withLink()));
      const dialog = openSheet();
      fireEvent.click(within(dialog).getByRole("button", { name: t.turnOffLink }));
      const confirm = screen.getByRole("dialog", { name: t.turnOffTitle });
      expect(confirm.textContent).toContain(t.turnOffHelp);
      expect(mocks.disableLink).not.toHaveBeenCalled();

      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.turnOffConfirm })); });
      expect(mocks.disableLink).toHaveBeenCalledWith(FOLDER);
      expect(mocks.refresh).toHaveBeenCalled();
      expect(within(dialog).queryByRole("textbox", { name: t.linkLabel })).toBeNull();
      expect(within(dialog).getByRole("button", { name: t.createLink })).toBeTruthy();
    });

    it("a failed replace keeps the confirmation open with the reason, and confirming again repeats the same request", async () => {
      mocks.createOrRotateLink.mockResolvedValueOnce({ ok: false, error: "failed" });
      render(view(locale, withLink()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: t.replaceLink }));
      const confirm = screen.getByRole("dialog", { name: t.replaceTitle });
      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.replaceConfirm })); });
      expect(within(confirm).getByRole("alert").textContent).toBe(t.errorFailed);
      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.replaceConfirm })); });
      expect(mocks.createOrRotateLink).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("dialog", { name: t.replaceTitle })).toBeNull();
    });

    it("follows a new link from the server (another tab replaced it)", () => {
      const { rerender } = render(view(locale, withLink()));
      const dialog = openSheet();
      rerender(view(locale, folderOf({ link: FRESH })));
      expect((within(dialog).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement).value).toBe(urlFor(FRESH));
    });
  });

  describe("the member list", () => {
    const team = () => folderOf({
      link: TOKEN,
      members: [person(VIEWER, "Dana", true, false, 1), person(KARIM, "Karim", false, false, 2), person(LINA, null, false, false, 3), person(GONE, "Gone Guy", false, true, 4)],
    });

    it("lists every active person by name, owner first, never an email, and leaves removed people out", () => {
      render(view(locale, team()));
      const list = within(openSheet()).getByRole("list", { name: t.membersLabel });
      const rows = within(list).getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      expect(rows[0].querySelector("bdi")!.textContent).toBe("Dana");
      expect(rows[0].textContent).toContain(t.youLabel);
      expect(rows[0].textContent).toContain(t.ownerLabel);
      expect(rows[1].querySelector("bdi")!.textContent).toBe("Karim");
      expect(rows[1].textContent).not.toContain(t.youLabel);
      // No name: a neutral label, not a blank and not an id.
      expect(rows[2].textContent).toContain(t.unnamedMember);
      expect(list.textContent).not.toContain("Gone Guy");
      expect(list.textContent).not.toMatch(/@|1a000000/);
    });

    it("an owner with no name yet shows as the Owner", () => {
      render(view(locale, folderOf({ members: [person(VIEWER, null, true)] })));
      const row = within(within(openSheet()).getByRole("list", { name: t.membersLabel })).getAllByRole("listitem")[0];
      expect(row.textContent).toContain(t.ownerLabel);
      expect(row.textContent).toContain(t.youLabel);
    });

    it("the owner can remove other people but not themselves", () => {
      render(view(locale, team()));
      const dialog = openSheet();
      expect(within(dialog).getByRole("button", { name: fill(t.removePersonNamed, { name: "Karim" }) })).toBeTruthy();
      expect(within(dialog).getByRole("button", { name: fill(t.removePersonNamed, { name: t.unnamedMember }) })).toBeTruthy();
      expect(within(dialog).queryByRole("button", { name: fill(t.removePersonNamed, { name: "Dana" }) })).toBeNull();
      expect(within(dialog).queryByRole("button", { name: fill(t.removePersonNamed, { name: "Gone Guy" }) })).toBeNull();
      expect(within(dialog).getAllByRole("button", { name: new RegExp(`^${fill(t.removePersonNamed, { name: ".*" })}$`) })).toHaveLength(2);
    });

    it("removing confirms, names the person, says their rows stay and that they cannot rejoin", async () => {
      render(view(locale, team()));
      const dialog = openSheet();
      fireEvent.click(within(dialog).getByRole("button", { name: fill(t.removePersonNamed, { name: "Karim" }) }));
      const confirm = screen.getByRole("dialog", { name: t.removeTitle });
      expect(within(confirm).getByText("Karim", { selector: "bdi" })).toBeTruthy();
      expect(confirm.textContent).toContain(t.removeHelp);
      expect(mocks.removeMember).not.toHaveBeenCalled();

      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.removePerson })); });
      expect(mocks.removeMember).toHaveBeenCalledWith(FOLDER, KARIM);
      expect(mocks.refresh).toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: t.removeTitle })).toBeNull();
      expect(within(dialog).queryByText("Karim", { selector: "bdi" })).toBeNull();
      expect(mocks.toast).toHaveBeenCalledWith(t.personRemoved);
    });

    it("a failed removal keeps the confirmation open with the reason", async () => {
      mocks.removeMember.mockResolvedValue({ ok: false, error: "conflict" });
      render(view(locale, team()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: fill(t.removePersonNamed, { name: "Karim" }) }));
      const confirm = screen.getByRole("dialog", { name: t.removeTitle });
      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.removePerson })); });
      expect(within(confirm).getByRole("alert").textContent).toBe(t.errorConflict);
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("a person who was removed elsewhere drops out of the list when the folder updates", () => {
      const { rerender } = render(view(locale, team()));
      const dialog = openSheet();
      rerender(view(locale, folderOf({ link: TOKEN, members: [person(VIEWER, "Dana", true)] })));
      expect(within(dialog).queryByText("Karim", { selector: "bdi" })).toBeNull();
    });
  });

  describe("someone who is not the owner", () => {
    const guest = () => folderOf({
      isOwner: false, link: null,
      members: [person(KARIM, "Karim", true, false, 1), person(VIEWER, "Dana", false, false, 2), person(LINA, "Lina", false, false, 3)],
    });

    it("sees the people but no link controls and no Remove", () => {
      render(view(locale, guest()));
      const dialog = openSheet();
      const rows = within(within(dialog).getByRole("list", { name: t.membersLabel })).getAllByRole("listitem");
      expect(rows.map((row) => row.querySelector("bdi")!.textContent)).toEqual(["Karim", "Dana", "Lina"]);
      expect(rows[1].textContent).toContain(t.youLabel);
      for (const name of [t.createLink, t.replaceLink, t.turnOffLink, t.copyLink, t.shareLink]) {
        expect(within(dialog).queryByRole("button", { name })).toBeNull();
      }
      expect(within(dialog).queryByRole("textbox", { name: t.linkLabel })).toBeNull();
      expect(within(dialog).queryByRole("button", { name: new RegExp(fill(t.removePersonNamed, { name: "" }).trim()) })).toBeNull();
    });

    it("can change their name in this folder", async () => {
      render(view(locale, guest()));
      const dialog = openSheet();
      const field = within(dialog).getByRole("textbox", { name: t.joinName }) as HTMLInputElement;
      expect(field.value).toBe("Dana");
      expect(field.maxLength).toBe(30);
      const save = within(dialog).getByRole("button", { name: t.saveName }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.change(field, { target: { value: "  " } });
      expect(save.disabled).toBe(true);
      fireEvent.change(field, { target: { value: " Dani " } });
      expect(save.disabled).toBe(false);
      await act(async () => { fireEvent.click(save); });
      expect(mocks.setMyName).toHaveBeenCalledWith(FOLDER, "Dani");
      expect(mocks.refresh).toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith(t.nameSaved);
      expect(within(dialog).getByRole("status").textContent).toBe(t.nameSaved);
      // Shown at once in the list too.
      expect(within(within(dialog).getByRole("list", { name: t.membersLabel })).getByText("Dani", { selector: "bdi" })).toBeTruthy();
    });

    it("Leave folder confirms, says their rows stay, then goes to the folder list", async () => {
      render(view(locale, guest()));
      const dialog = openSheet();
      fireEvent.click(within(dialog).getByRole("button", { name: t.leaveFolder }));
      const confirm = screen.getByRole("dialog", { name: t.leaveTitle });
      expect(confirm.textContent).toContain(t.leaveHelp);
      expect(mocks.leaveFolder).not.toHaveBeenCalled();

      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.leaveFolder })); });
      expect(mocks.leaveFolder).toHaveBeenCalledWith(FOLDER);
      // The action does not revalidate (the folder page would redirect to the lost-access notice); the screen leaves, then refreshes.
      expect(mocks.push).toHaveBeenCalledWith("/invoices");
      expect(mocks.refresh).toHaveBeenCalled();
    });

    it("a failed leave stays on the folder and says why", async () => {
      mocks.leaveFolder.mockResolvedValue({ ok: false, error: "failed" });
      render(view(locale, guest()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: t.leaveFolder }));
      const confirm = screen.getByRole("dialog", { name: t.leaveTitle });
      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.leaveFolder })); });
      expect(within(confirm).getByRole("alert").textContent).toBe(t.errorFailed);
      expect(mocks.push).not.toHaveBeenCalled();
    });
  });

  describe("link note and base path", () => {
    it("the \"Link copied\" note goes away when the link is replaced", async () => {
      setNavigator("clipboard", { writeText: vi.fn().mockResolvedValue(undefined) });
      render(view(locale, folderOf({ link: TOKEN })));
      const dialog = openSheet();
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: t.copyLink })); });
      expect(within(dialog).getAllByRole("status")[0].textContent).toBe(t.linkCopied);
      fireEvent.click(within(dialog).getByRole("button", { name: t.replaceLink }));
      const confirm = screen.getByRole("dialog", { name: t.replaceTitle });
      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.replaceConfirm })); });
      expect((within(dialog).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement).value).toBe(urlFor(FRESH));
      expect(within(dialog).getAllByRole("status")[0].textContent).toBe("");
    });

    it("builds the join address under a sub-path, ignoring trailing slashes on the base path", () => {
      for (const base of ["/budget", "/budget/", "/budget//"]) {
        vi.stubEnv("NEXT_PUBLIC_BASE_PATH", base);
        render(view(locale, folderOf({ link: TOKEN })));
        const field = within(openSheet()).getByRole("textbox", { name: t.linkLabel }) as HTMLInputElement;
        expect(field.value).toBe(`${window.location.origin}/budget/${locale}/invoices/join/${TOKEN}`);
        cleanup();
      }
    });
  });

  describe("pressing a confirm button twice quickly acts once", () => {
    const team = () => folderOf({
      isOwner: true, link: TOKEN,
      members: [person(VIEWER, "Dana", true, false, 1), person(KARIM, "Karim", false, false, 2)],
    });
    const guest = () => folderOf({
      isOwner: false, link: null,
      members: [person(KARIM, "Karim", true, false, 1), person(VIEWER, "Dana", false, false, 2)],
    });
    const twice = async (button: HTMLElement) => { await act(async () => { fireEvent.click(button); fireEvent.click(button); }); };

    it("Remove", async () => {
      render(view(locale, team()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: fill(t.removePersonNamed, { name: "Karim" }) }));
      await twice(within(screen.getByRole("dialog", { name: t.removeTitle })).getByRole("button", { name: t.removePerson }));
      expect(mocks.removeMember).toHaveBeenCalledTimes(1);
    });

    it("Replace", async () => {
      render(view(locale, team()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: t.replaceLink }));
      await twice(within(screen.getByRole("dialog", { name: t.replaceTitle })).getByRole("button", { name: t.replaceConfirm }));
      expect(mocks.createOrRotateLink).toHaveBeenCalledTimes(1);
    });

    it("Turn off", async () => {
      render(view(locale, team()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: t.turnOffLink }));
      await twice(within(screen.getByRole("dialog", { name: t.turnOffTitle })).getByRole("button", { name: t.turnOffConfirm }));
      expect(mocks.disableLink).toHaveBeenCalledTimes(1);
    });

    it("Leave, also after it succeeded and while the address is still changing", async () => {
      render(view(locale, guest()));
      fireEvent.click(within(openSheet()).getByRole("button", { name: t.leaveFolder }));
      const confirm = screen.getByRole("dialog", { name: t.leaveTitle });
      const button = within(confirm).getByRole("button", { name: t.leaveFolder });
      await twice(button);
      expect(mocks.leaveFolder).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledTimes(1);
      // The sheet stays up while the page navigates; the button stays disabled and does not send again.
      expect((within(confirm).getByRole("button", { name: t.leaveFolder }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: t.leaveFolder })); });
      expect(mocks.leaveFolder).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledTimes(1);
    });
  });

  describe("the owner's own name", () => {
    it("can be changed later, in the same field members use, and shows at once in the list", async () => {
      render(view(locale, folderOf({ link: TOKEN })));
      const dialog = openSheet();
      const field = within(dialog).getByRole("textbox", { name: t.joinName }) as HTMLInputElement;
      expect(field.value).toBe("Dana");
      const save = within(dialog).getByRole("button", { name: t.saveName }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.change(field, { target: { value: " Dani " } });
      expect(save.disabled).toBe(false);
      await act(async () => { fireEvent.click(save); });
      expect(mocks.setMyName).toHaveBeenCalledWith(FOLDER, "Dani");
      expect(mocks.refresh).toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith(t.nameSaved);
      expect(within(within(dialog).getByRole("list", { name: t.membersLabel })).getByText("Dani", { selector: "bdi" })).toBeTruthy();
      // Still no Leave for the owner.
      expect(within(dialog).queryByRole("button", { name: t.leaveFolder })).toBeNull();
    });

    it("is asked for once, in the first-share prompt only, until they have one", () => {
      render(view(locale, folderOf({ members: [person(VIEWER, null, true)] })));
      const dialog = openSheet();
      expect(within(dialog).getAllByRole("textbox", { name: t.joinName })).toHaveLength(1);
      expect((within(dialog).getByRole("textbox", { name: t.joinName }) as HTMLInputElement).required).toBe(true);
      expect(within(dialog).queryByRole("button", { name: t.saveName })).toBeNull();
    });
  });

  it("the owner is not offered Leave", () => {
    render(view(locale, folderOf()));
    expect(within(openSheet()).queryByRole("button", { name: t.leaveFolder })).toBeNull();
  });
});
