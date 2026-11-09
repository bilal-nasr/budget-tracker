import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; count?: number | null; error?: { message?: string } | null };
const mocks = vi.hoisted(() => ({
  configured: true,
  userId: null as string | null,
  /** Keyed `table` for lists and `table.maybeSingle` for single-row reads. */
  tables: {} as Record<string, Result>,
  rpcs: {} as Record<string, Result>,
  rpcCalls: [] as [string, unknown][],
  selects: [] as [string, unknown[]][],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/user", () => ({ getUserId: async () => mocks.userId }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const self: Record<string, unknown> = {};
      let single = false;
      for (const method of ["select", "order", "limit", "gt", "eq", "or", "maybeSingle"]) {
        self[method] = (...args: unknown[]) => { if (method === "select") mocks.selects.push([table, args]); if (method === "maybeSingle") single = true; return self; };
      }
      self.then = (resolve: (value: Result) => unknown) =>
        resolve((single ? mocks.tables[`${table}.maybeSingle`] : undefined) ?? mocks.tables[table] ?? { data: [], error: null });
      return self;
    },
    rpc(name: string, args: unknown) {
      mocks.rpcCalls.push([name, args]);
      return Promise.resolve(mocks.rpcs[name] ?? { data: null, error: null });
    },
  }),
}));
import { DEMO_INVOICE_TOKEN, getInvoiceFolder, getInvoiceFolderCount, getInvoiceFolders, ownInvoiceFolderForLink, previewInvoiceLink } from "./queries";

const uid = (n: number) => `ac000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [me, karim, lina, folderA, folderB, item1, item2, item3] = [uid(1), uid(2), uid(3), uid(10), uid(11), uid(20), uid(21), uid(22)];
const token = "cd".repeat(32);

const folderRow = (id: string, name: string, owner: string, created: string) => ({ id, name, owner_id: owner, created_at: created });
const itemRow = (id: string, folder: string, extra: Record<string, unknown> = {}) =>
  ({ id, folder_id: folder, name: "Thing", currency: "USD", decimal_places: 2, price_minor: 100, created_by: me, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...extra });
const memberRow = (folder: string, user: string, extra: Record<string, unknown> = {}) =>
  ({ folder_id: folder, user_id: user, display_name: null, joined_at: "2026-11-01T00:00:00Z", removed_at: null, ...extra });

beforeEach(() => {
  mocks.configured = true;
  mocks.userId = me;
  mocks.tables = {};
  mocks.rpcs = {};
  mocks.rpcCalls.length = 0;
  mocks.selects.length = 0;
});

describe("preview mode (no database)", () => {
  beforeEach(() => { mocks.configured = false; mocks.userId = null; });

  it("lists synthetic folders with per-currency totals and a shared one", async () => {
    const folders = await getInvoiceFolders();
    const pc = folders.find((folder) => folder.name === "PC build");
    const living = folders.find((folder) => folder.name === "Living room");
    expect(pc).toMatchObject({ isOwner: true, itemCount: 5 });
    expect(pc?.totals).toEqual([
      { currency: "USD", decimalPlaces: 2, minor: 80000 },
      { currency: "LBP", decimalPlaces: 0, minor: 1800000 },
    ]);
    expect(living?.isOwner).toBe(false);
    expect(living?.memberCount).toBeGreaterThan(1);
  });

  it("opens a demo folder newest first, and anything else is null", async () => {
    const [pc] = await getInvoiceFolders();
    const detail = await getInvoiceFolder(pc.id);
    expect(detail).toMatchObject({ name: "PC build", isOwner: true });
    expect(detail?.items.map((row) => row.name)).toEqual(expect.arrayContaining(["CPU", "GPU", "MSI MAG Forge 120A Airflow Mid-Tower (6× Fans, 330mm GPU support)", "Cables"]));
    const times = detail?.items.map((row) => row.createdAt) ?? [];
    expect([...times].sort().reverse()).toEqual(times);
    expect(await getInvoiceFolder(uid(99))).toBeNull();
  });

  it("hands out a copy of the demo folder, so changing it changes nothing for the next reader", async () => {
    const [pc] = await getInvoiceFolders();
    const first = (await getInvoiceFolder(pc.id))!;
    first.name = "Changed";
    first.items.pop();
    first.members.length = 0;
    first.items[0].name = "Changed too";
    const again = (await getInvoiceFolder(pc.id))!;
    expect(again).not.toBe(first);
    expect(again.name).toBe("PC build");
    expect(again.items).toHaveLength(5);
    expect(again.items[0].name).not.toBe("Changed too");
    expect(again.members).toHaveLength(1);
  });

  it("counts the demo folders", async () => {
    expect(await getInvoiceFolderCount()).toBe((await getInvoiceFolders()).length);
    expect(await getInvoiceFolderCount()).toBeGreaterThan(0);
  });

  it("previews only the demo link", async () => {
    expect(await previewInvoiceLink("ee".repeat(32))).toBeNull();
    expect(await previewInvoiceLink(DEMO_INVOICE_TOKEN)).toEqual({ name: "Living room" });
  });
});

describe("getInvoiceFolderCount", () => {
  it("is a head count of the folders the viewer can see, never reading rows or items", async () => {
    mocks.tables.invoice_folders = { data: null, count: 4, error: null };
    expect(await getInvoiceFolderCount()).toBe(4);
    expect(mocks.selects).toEqual([["invoice_folders", ["id", { count: "exact", head: true }]]]);
  });

  it("is 0 for nobody signed in or no count, and a failed read throws so callers can fall back", async () => {
    mocks.userId = null;
    expect(await getInvoiceFolderCount()).toBe(0);
    expect(mocks.selects).toEqual([]);
    mocks.userId = me;
    mocks.tables.invoice_folders = { data: null, count: null, error: null };
    expect(await getInvoiceFolderCount()).toBe(0);
    mocks.tables.invoice_folders = { data: null, error: { message: "boom" } };
    await expect(getInvoiceFolderCount()).rejects.toThrow();
  });
});

describe("getInvoiceFolders", () => {
  it("returns nothing when nobody is signed in", async () => {
    mocks.userId = null;
    expect(await getInvoiceFolders()).toEqual([]);
  });

  it("lists own and joined folders newest first with counts and per-currency totals", async () => {
    mocks.tables.invoice_folders = { data: [folderRow(folderA, "PC build", me, "2026-11-01T00:00:00Z"), folderRow(folderB, "Living room", karim, "2026-11-05T00:00:00Z")], error: null };
    mocks.tables.invoice_items = {
      data: [
        itemRow(item1, folderA, { price_minor: "25000" }),
        itemRow(item2, folderA, { currency: "LBP", decimal_places: 0, price_minor: 150000 }),
        itemRow(item3, folderB, { price_minor: 500 }),
      ],
      error: null,
    };
    mocks.tables.invoice_members = {
      data: [memberRow(folderA, me), memberRow(folderB, me), memberRow(folderB, karim), memberRow(folderB, lina, { removed_at: "2026-11-02T00:00:00Z" })],
      error: null,
    };
    expect(await getInvoiceFolders()).toEqual([
      { id: folderB, name: "Living room", isOwner: false, memberCount: 2, itemCount: 1, totals: [{ currency: "USD", decimalPlaces: 2, minor: 500 }] },
      {
        id: folderA, name: "PC build", isOwner: true, memberCount: 1, itemCount: 2,
        totals: [{ currency: "USD", decimalPlaces: 2, minor: 25000 }, { currency: "LBP", decimalPlaces: 0, minor: 150000 }],
      },
    ]);
  });

  it("refuses rows with an invalid currency or unreadable error", async () => {
    mocks.tables.invoice_folders = { data: [folderRow(folderA, "PC", me, "2026-11-01T00:00:00Z")], error: null };
    mocks.tables.invoice_items = { data: [itemRow(item1, folderA, { currency: "usd!" })], error: null };
    await expect(getInvoiceFolders()).rejects.toThrow();
    mocks.tables.invoice_items = { data: null, error: { message: "boom" } };
    await expect(getInvoiceFolders()).rejects.toThrow();
  });
});

describe("getInvoiceFolder", () => {
  const setup = (owner: string, members: ReturnType<typeof memberRow>[]) => {
    mocks.tables["invoice_folders.maybeSingle"] = { data: folderRow(folderA, "PC build", owner, "2026-11-01T00:00:00Z"), error: null };
    mocks.tables.invoice_items = {
      data: [
        itemRow(item1, folderA, { created_at: "2026-11-01T00:00:00Z", created_by: karim }),
        itemRow(item2, folderA, { created_at: "2026-11-03T00:00:00Z", created_by: null }),
      ],
      error: null,
    };
    mocks.tables.invoice_members = { data: members, error: null };
    mocks.tables["invoice_links.maybeSingle"] = { data: { token }, error: null };
  };

  it("gives the owner items newest first, removed members and the link token", async () => {
    setup(me, [
      memberRow(folderA, me, { display_name: "Sam" }),
      memberRow(folderA, lina, { display_name: "Lina", joined_at: "2026-11-01T12:00:00Z", removed_at: "2026-11-04T00:00:00Z" }),
    ]);
    const detail = await getInvoiceFolder(folderA);
    expect(detail).toMatchObject({ id: folderA, name: "PC build", isOwner: true, viewerId: me, link: token });
    expect(detail?.items.map((row) => row.id)).toEqual([item2, item1]);
    expect(detail?.items[0].createdBy).toBeNull();
    expect(detail?.members.map((member) => [member.userId, member.isOwner, member.removed])).toEqual([[me, true, false], [lina, false, true]]);
  });

  it("hides the link and removed members from a plain member", async () => {
    setup(karim, [memberRow(folderA, me, { display_name: "Me" }), memberRow(folderA, karim, { display_name: "Karim" }), memberRow(folderA, lina, { removed_at: "2026-11-04T00:00:00Z" })]);
    const detail = await getInvoiceFolder(folderA);
    expect(detail).toMatchObject({ isOwner: false, link: null });
    expect(detail?.members.map((member) => member.userId)).toEqual([karim, me]); // owner first
    expect(detail?.members[0].isOwner).toBe(true);
  });

  it("is null when the folder is invisible, the id is malformed, or the viewer is not an active member", async () => {
    expect(await getInvoiceFolder(folderA)).toBeNull();
    expect(await getInvoiceFolder("not-a-uuid")).toBeNull();
    setup(karim, [memberRow(folderA, karim)]);
    expect(await getInvoiceFolder(folderA)).toBeNull();
    mocks.userId = null;
    expect(await getInvoiceFolder(folderA)).toBeNull();
  });

  it("ignores a link row that is not a valid token", async () => {
    setup(me, [memberRow(folderA, me)]);
    mocks.tables["invoice_links.maybeSingle"] = { data: { token: "short" }, error: null };
    expect((await getInvoiceFolder(folderA))?.link).toBeNull();
  });
});

describe("previewInvoiceLink", () => {
  it("returns the folder name, or null for anything that does not work", async () => {
    mocks.rpcs.invoice_link_preview = { data: "PC build", error: null };
    expect(await previewInvoiceLink(token)).toEqual({ name: "PC build" });
    expect(mocks.rpcCalls).toEqual([["invoice_link_preview", { p_token: token }]]);
    mocks.rpcs.invoice_link_preview = { data: null, error: null };
    expect(await previewInvoiceLink(token)).toBeNull();
    mocks.rpcs.invoice_link_preview = { data: null, error: { message: "boom" } };
    expect(await previewInvoiceLink(token)).toBeNull();
    mocks.rpcCalls.length = 0;
    expect(await previewInvoiceLink("short")).toBeNull();
    expect(mocks.rpcCalls).toHaveLength(0);
  });
});

describe("ownInvoiceFolderForLink", () => {
  it("returns the folder behind the owner's own link (only the owner can read links)", async () => {
    mocks.tables["invoice_links.maybeSingle"] = { data: { folder_id: folderA }, error: null };
    expect(await ownInvoiceFolderForLink(token)).toBe(folderA);
  });

  it("is null for anyone else, a failed read, a bad row, a malformed token, nobody signed in, or preview mode", async () => {
    mocks.tables["invoice_links.maybeSingle"] = { data: null, error: null };
    expect(await ownInvoiceFolderForLink(token)).toBeNull();
    mocks.tables["invoice_links.maybeSingle"] = { data: null, error: { message: "boom" } };
    expect(await ownInvoiceFolderForLink(token)).toBeNull();
    mocks.tables["invoice_links.maybeSingle"] = { data: { folder_id: "nope" }, error: null };
    expect(await ownInvoiceFolderForLink(token)).toBeNull();
    mocks.tables["invoice_links.maybeSingle"] = { data: { folder_id: folderA }, error: null };
    expect(await ownInvoiceFolderForLink("../x")).toBeNull();
    mocks.userId = null;
    expect(await ownInvoiceFolderForLink(token)).toBeNull();
    mocks.userId = me;
    mocks.configured = false;
    expect(await ownInvoiceFolderForLink(DEMO_INVOICE_TOKEN)).toBeNull();
  });
});
