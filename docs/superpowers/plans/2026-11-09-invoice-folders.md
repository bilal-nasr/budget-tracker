# Invoice Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Invoices" section: named folders of item/price/currency rows with per-currency totals, shareable by link so everyone in a folder can edit any row and see each other's changes live.

**Architecture:** Four new tables (`invoice_folders`, `invoice_members`, `invoice_links`, `invoice_items`) with row-level security keyed on a `is_invoice_member(folder)` function. Joining, removing and link management go through security-definer functions, never direct writes. Reads happen in Server Components; writes in zod-validated Server Actions; the open folder screen subscribes to Supabase Realtime for that folder and refetches on focus or when the connection drops.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS + Realtime), zod, next-intl (EN/AR), Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-invoice-folders-design.md` (read it first; this plan does not repeat its reasoning).

## Global Constraints

- **Do not run `git commit`, `git add`+commit, or push.** The owner commits manually. Stop each task after its checks pass.
- Mobile first at 390px; base Tailwind = phone. `min-h-dvh`, safe-area insets on fixed bars, touch targets ≥ 44px, inputs ≥ 16px.
- Logical utilities only (`ms-`, `pe-`, `start-`, `text-start`); no `ml-`, `pr-`, `left-`, `text-left`. Names and amounts in `<bdi>`; amounts never mirror.
- Every user-visible string in both `src/messages/en.json` and `src/messages/ar.json` in the same change, under a new `Invoices` namespace.
- Money: integer minor units only; parse/format only through `src/lib/money.ts` and `src/lib/currency.ts`; never add or compare different currencies (group by currency code AND decimal places). Max price is `MAX_MINOR`.
- Schema changes only via `supabase/migrations/` with SQL tests. RLS on every table. App code uses the publishable key plus the user session; the secret key is never imported under `src/`.
- Writes use client-generated ids so a retry never creates a duplicate row (as `src/features/items/actions.ts` does).
- Use the `impeccable` skill before any UI work; read `.claude/skills/impeccable/reference/craft-floor.md` before UI edits. Follow `DESIGN.md`. Skeletons for loading (no "Loading…" text), optimistic updates without layout jump, respect `prefers-reduced-motion`. New screens need 390px screenshots in EN and AR for the owner before the work is called done (`docs/MOBILE-UX.md` §14).
- Limits (spec): folder name and item name 1–60 characters; person name 1–30 characters; 100 folders per owner; 500 rows per folder; 20 people besides the owner per folder.
- Follow the existing Items feature (`src/features/items/*`, `src/components/items/*`) for patterns.

## Review Focus

Each line below is pinned by a test in the task named in brackets.

1. A viewer who has not enabled a row's currency opens the folder: it renders with the plain currency code and the stored decimals instead of crashing (`Amount` throws on unknown currencies today). [Task 2, Task 6]
2. The owner removes a person while that person has the folder open: their next refetch leaves the folder with a notice and shows no stale rows; a removed person cannot rejoin by link. [Task 1, Task 8]
3. A link opened twice, opened by the owner, or "Join" double-tapped: exactly one membership, no error. A garbage, expired, replaced or switched-off token: one generic message and no server error. [Task 1, Task 4]
4. Two people edit the same row, or one deletes a row another is editing: later save wins; the editor sees "this item was removed", not a raw error. [Task 3, Task 6]
5. 60-character names and mixed Arabic/Latin names at 360px width, and a total too large to sum: no horizontal scroll; the total shows "too large to show". [Task 2, Task 6]

---

### Task 1: Database tables, security and SQL tests

**Files:**
- Replace: `supabase/migrations/20261201000000_invoice_folders.sql` (an uncommitted private-only draft exists; overwrite it)
- Replace: `supabase/tests/invoice_folders.test.sql` (same)

**Interfaces:**
- Produces (database objects later tasks call by exact name):
  - Tables `invoice_folders(id, owner_id, name, created_at, updated_at)`, `invoice_members(folder_id, user_id, display_name null, joined_at, removed_at null)`, `invoice_links(folder_id primary key, token unique, created_at)`, `invoice_items(id, folder_id, name, currency, decimal_places smallint 0..8, price_minor, created_by null, updated_by null, created_at, updated_at)`.
  - `public.is_invoice_member(folder uuid) returns boolean` (security definer, stable, `set search_path = ''`; true when the caller has an `invoice_members` row for the folder with `removed_at is null`).
  - RPCs (all security definer, callable by `authenticated` only): `invoice_link_preview(p_token text) returns text` (folder name or null), `join_invoice_folder(p_token text, p_name text) returns uuid` (folder id; raises `invoices.link` for any unusable token, `invoices.removed` is also reported as `invoices.link`, `invoices.full` when the folder already has 20 people besides the owner), `rotate_invoice_link(p_folder uuid, p_owner_name text) returns text` (owner only; creates or replaces the single link, sets the owner's `display_name` if null, returns the token), `disable_invoice_link(p_folder uuid) returns void`, `remove_invoice_member(p_folder uuid, p_user uuid) returns void` (owner only; sets `removed_at`), `leave_invoice_folder(p_folder uuid) returns void` (deletes the caller's member row; the owner cannot leave).
  - Error messages raised: `invoices.invalid`, `invoices.link`, `invoices.full`, `invoices.limit` (folder or row cap).

- [ ] **Step 1: Write the failing pgTAP tests** in `supabase/tests/invoice_folders.test.sql` (same header/impersonation style as `supabase/tests/shopping_items.test.sql`). Three synthetic users A (owner), B (member), C (stranger). Assertions, one each: owner creates a folder and is automatically an `invoice_members` row; folder and item names are trimmed and blank/over-length rejected (`23514`); price 0 and price over `MAX_MINOR` rejected; `decimal_places` outside 0..8 rejected; stranger C sees no folder, member, link or item and cannot insert an item into A's folder; `rotate_invoice_link` as B raises `invoices.invalid` and returns a token for A; `invoice_links` is unreadable by B; `join_invoice_folder` with A's token makes B a member who then reads items; B joining twice leaves one member row; A joining their own token returns the folder id without a second row; B can insert, update and delete an item added by A; B cannot rename or delete the folder (zero rows affected); B cannot insert a member row directly; `invoice_link_preview` returns the folder name for a good token and null for a bad one; rotating makes the old token fail with `invoices.link`; `disable_invoice_link` makes the token fail; `remove_invoice_member` as A removes B: B sees nothing and `join_invoice_folder` with a fresh token raises `invoices.link`; B's items stay with `created_by` still set; `leave_invoice_folder` as a member lets them rejoin; the 21st person (20 members + owner already) raises `invoices.full`; inserting the 501st item raises `invoices.limit` (use `generate_series`); creating the 101st folder as one owner raises `invoices.limit`; deleting a folder removes its items, members and link; item `updated_at`/`updated_by` are set on update; `created_by` cannot be changed.
- [ ] **Step 2: Start Docker Desktop**, then run `pnpm db:start` and `pnpm db:reset`; run `pnpm db:test` and confirm `invoice_folders.test.sql` fails (tables missing). Expected: FAIL. Docker is not running on this machine right now, so this step needs the owner to start it.
- [ ] **Step 3: Write the migration.** Token generation: `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`. RLS policies: folders select via `is_invoice_member(id)`, insert `owner_id = auth.uid()`, update/delete owner only; members select where `is_invoice_member(folder_id)` and (`removed_at is null` or caller is the owner), update only the caller's own `display_name` (trigger blocks other columns), no insert/delete policy; links owner only; items all four operations via `is_invoice_member(folder_id)`. A trigger on folder insert adds the owner's member row. Integrity triggers: `created_by` set to `auth.uid()` on insert and immutable; `updated_by`/`updated_at` set on update; `folder_id` immutable; caps raise `invoices.limit`. Trim names in triggers. Add the items, members and folders tables to the `supabase_realtime` publication.
- [ ] **Step 4: Run `pnpm db:reset` then `pnpm db:test`.** Expected: all tests pass, including the existing `isolation.test.sql`. If `src/lib/supabase/database.types.ts` lists tables, run `pnpm db:types`.

### Task 2: Types, validation, totals and currency display helpers

**Files:**
- Create: `src/features/invoices/schema.ts`, `src/features/invoices/totals.ts`, `src/features/invoices/display.ts`
- Test: `src/features/invoices/totals.test.ts`, `src/features/invoices/display.test.ts`, `src/features/invoices/schema.test.ts`

**Interfaces:**
- Consumes: `sumMinor`, `MAX_MINOR` from `@/lib/money`; `CurrencyDefinition` from `@/lib/currency`; `currencyCodeSchema` from `@/features/currencies/schema`.
- Produces:
  - `schema.ts`: constants `MAX_NAME = 60`, `MAX_PERSON_NAME = 30`, `MAX_FOLDERS = 100`, `MAX_ITEMS = 500`, `MAX_GUESTS = 20`; zod schemas `folderCreateSchema {id: uuid, name}`, `folderRenameSchema {name}`, `itemCreateSchema {id: uuid, folderId: uuid, name, currency, decimalPlaces: int 0..8, priceMinor: int 1..MAX_MINOR, expectedUnits?}`, `itemEditSchema {name, priceMinor, currency?, decimalPlaces?}` (currency and decimalPlaces together or not at all), `personNameSchema` (trimmed, 1..30), `tokenSchema` (string matching `^[0-9a-f]{64}$`); types `InvoiceItem {id, folderId, name, currency, decimalPlaces, priceMinor, createdBy: string | null, createdAt, updatedAt}`, `InvoiceMember {userId, displayName: string | null, isOwner: boolean, joinedAt, removed: boolean}`, `InvoiceFolderSummary {id, name, isOwner, memberCount, itemCount, totals: CurrencyTotal[]}`, `CurrencyTotal {currency: string, decimalPlaces: number, minor: number | null}`.
  - `totals.ts`: `totalsByCurrency(items: readonly Pick<InvoiceItem, "currency" | "decimalPlaces" | "priceMinor">[]): CurrencyTotal[]` (grouped by code and decimals, ordered by first appearance; `minor: null` when the sum exceeds the safe range).
  - `display.ts`: `rowDefinition(row: { currency: string; decimalPlaces: number }, viewerCatalog: ReadonlyMap<string, CurrencyDefinition>): CurrencyDefinition` (symbol from the viewer's catalog when the code exists, else the code itself; decimals always from the row), and `canAddIn(code: string, viewerEnabled: readonly CurrencyDefinition[]): boolean`.

- [ ] **Step 1: Write failing tests.** `totals.test.ts`: `[250 USD/2, 450 USD/2, 100 USD/2, 1_500_000 LBP/0]` gives `[{USD,2,80000}, {LBP,0,1500000}]` in that order; USD/2 and a hypothetical USD/3 stay separate; an overflowing sum yields `minor: null` for that entry only; empty input yields `[]`. `display.test.ts`: a row in `XYZ` with 3 decimals against a catalog without `XYZ` returns `{code: "XYZ", symbol: "XYZ", decimalPlaces: 3}` and never throws; a catalog `USD` row keeps symbol `$` but takes decimals from the row. `schema.test.ts`: 61-character names rejected, `priceMinor` 0 and `MAX_MINOR + 1` rejected, `decimalPlaces: 9` rejected, a 63-character token rejected, an edit with `currency` but no `decimalPlaces` rejected.
- [ ] **Step 2: Run** `pnpm test src/features/invoices` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three files per the interfaces above.
- [ ] **Step 4: Run** `pnpm test src/features/invoices` and `pnpm typecheck` — Expected: PASS.

### Task 3: Queries and Server Actions

**Files:**
- Create: `src/features/invoices/queries.ts`, `src/features/invoices/actions.ts`, `src/features/invoices/errors.ts`
- Modify: `src/lib/supabase/action.ts` (add `"linkInvalid" | "limitReached"` to `ActionError` and map `invoices.invalid → conflict`, `invoices.link → linkInvalid`, `invoices.full`/`invoices.limit → limitReached` in its database-error table)
- Test: `src/features/invoices/actions.test.ts` (same mocking style as `src/features/items/actions.test.ts`)

**Interfaces:**
- Consumes: Task 1 tables/RPCs; Task 2 schemas and types.
- Produces (queries, `import "server-only"`):
  - `getInvoiceFolders(): Promise<InvoiceFolderSummary[]>` (newest first; includes folders the viewer joined; synthetic demo data when `!supabaseConfigured()`).
  - `getInvoiceFolder(id: string): Promise<InvoiceFolderDetail | null>` where `InvoiceFolderDetail = { id, name, isOwner, viewerId, items: InvoiceItem[] /* newest first */, members: InvoiceMember[] /* active only, plus removed ones when isOwner */, link: string | null /* owner only */ }`; returns `null` when the viewer is not an active member (also the case after removal).
  - `previewInvoiceLink(token: string): Promise<{ name: string } | null>`.
- Produces (actions, `"use server"`, all return `ActionResult`; mutate then `revalidatePath("/", "layout")`):
  - `createFolder(input: {id; name})`, `renameFolder(id, {name})`, `deleteFolder(id)`
  - `addItem(input: ItemCreateInput)`, `updateItem(id, input: ItemEditInput)`, `deleteItem(id)`, `restoreItem(id: string)` (Undo: calls the `restore_invoice_item(p_item uuid)` RPC, which restores the deleted row from a server-side record with its original author and values)
  - `createOrRotateLink(folderId, ownerName?) → ActionResult<{ token: string }>`, `disableLink(folderId)`
  - `joinFolder(token, displayName) → ActionResult<{ folderId: string }>`, `setMyName(folderId, name)`, `removeMember(folderId, userId)`, `leaveFolder(folderId)`
  - `invoiceErrorKey(error: ActionError): string` in `errors.ts`, returning keys of the `Invoices` namespace (`errorInvalid`, `errorConflict`, `errorFailed`, `errorPreview`, `errorLink`, `errorLimit`, `errorCurrency`).

- [ ] **Step 1: Write failing action tests** covering: every action rejects invalid input before any database call (`mocks.ctx` not called); `addItem` upserts with `onConflict: "id", ignoreDuplicates: true` (a retried id is a no-op); `updateItem` on a row that no longer exists returns `{ok:false, error:"conflict"}` (Review Focus 4); `joinFolder` maps `invoices.link` to `linkInvalid` and calls the `join_invoice_folder` RPC exactly once; `createOrRotateLink` passes the owner name; `restoreItem` calls the `restore_invoice_item` RPC with the item id; every action returns `notConfigured` without a database.
- [ ] **Step 2: Run** `pnpm test src/features/invoices/actions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the queries (keyset reads through `readAllByKey`, as `src/features/items/queries.ts` does; map rows to the types, validating currency codes and `readMinor`) and the actions.
- [ ] **Step 4: Run** `pnpm test src/features/invoices` and `pnpm typecheck` — Expected: PASS.

### Task 4: Opening a share link (preview, join, return after sign-in)

**Files:**
- Create: `src/app/[locale]/(app)/invoices/join/[token]/page.tsx`, `src/components/invoices/join-view.tsx`, `src/features/invoices/pending-join.ts`
- Modify: `src/proxy.ts` (remember the link for signed-out visitors), `src/features/auth/actions.ts` and the `/auth/confirm` route (go to the remembered link after a successful sign-in or email confirmation)
- Test: `src/components/invoices/join-view.test.tsx`, `src/features/invoices/pending-join.test.ts`, `src/proxy.test.ts` (create if absent)

**Interfaces:**
- Consumes: `previewInvoiceLink`, `joinFolder`, `tokenSchema`.
- Produces: `JOIN_COOKIE = "join_invoice"`; `rememberJoin(token: string): string` (returns the `Set-Cookie`-ready value used by the proxy; httpOnly, `sameSite: "lax"`, 24 hours); `takePendingJoin(): Promise<string | null>` (reads and clears the cookie, returns a path like `/invoices/join/<token>` only when the token matches `tokenSchema`, else `null`); `JoinView({ token, folderName }: ...)` client component.

- [ ] **Step 1: Write failing tests.** `pending-join.test.ts`: a valid cookie yields the path once then `null`; a cookie with `../x` or a 63-character token yields `null`. Proxy test: a signed-out request to `/en/invoices/join/<64 hex>` redirects to `/en/sign-in` with the cookie set; a signed-out request to any other URL does not set it. `join-view.test.tsx`: shows the folder name and a name field; Join disabled until a name is entered; double-pressing Join calls `joinFolder` once; `linkInvalid` shows the single generic message "This link doesn't work. Ask for a new one." (both languages); an unknown token on the page renders that same message and not a 500 (Review Focus 3).
- [ ] **Step 2: Run** `pnpm test src/features/invoices src/components/invoices src/proxy.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** The page loads `previewInvoiceLink`; null → generic message. After a successful join, `router.replace` to `/invoices/<folderId>`. The owner opening their own link goes straight to the folder. Wire `takePendingJoin()` into the post-sign-in and post-confirmation redirects (they currently go to `/`).
- [ ] **Step 4: Run** the same tests plus `pnpm typecheck` — Expected: PASS. Then confirm manually in the browser pane (preview mode shows the generic message because no database is configured).

### Task 5: Folder list screen and the Wallets entry

**Files:**
- Create: `src/app/[locale]/(app)/invoices/page.tsx`, `loading.tsx`, `error.tsx`; `src/components/invoices/folders-view.tsx`
- Modify: `src/components/wallets/commitments.tsx` (add an "Invoices" row after the Item calculator row; its `href` union gains `"/invoices"`), `src/messages/en.json`, `src/messages/ar.json` (start the `Invoices` namespace: title, empty state, create-folder field and button, folder count lines, "Shared" marker, "Shared with you", errors)
- Test: `src/components/invoices/folders-view.test.tsx`

**Interfaces:**
- Consumes: `getInvoiceFolders`, `createFolder`, `InvoiceFolderSummary`, `Amount`, `rowDefinition`.
- Produces: `FoldersView({ folders }: { folders: InvoiceFolderSummary[] })`; route `/invoices`; route `/invoices/[id]` links from each row.

- [ ] **Step 1: Before building, show the owner a 390px mockup of the folder list** (EN) via the visual companion session already running; adjust once if asked.
- [ ] **Step 2: Write the failing test.** Rendered folders show name, row count, at most two currency totals then "+N" (Wallets pattern), a "Shared" marker when `memberCount > 1` or `!isOwner`; an empty list shows the empty state; creating a folder adds it optimistically with a client-generated id and restores the text on failure; test in EN and AR.
- [ ] **Step 3: Run** `pnpm test src/components/invoices/folders-view.test.tsx` — Expected: FAIL.
- [ ] **Step 4: Implement** following `items-view.tsx` and `commitments.tsx`; every folder total uses a synthesized `CurrencyDefinition` from `rowDefinition`.
- [ ] **Step 5: Run** the test, `pnpm typecheck`, `pnpm lint` — Expected: PASS.

### Task 6: Folder screen: totals, add, edit, delete with Undo

**Files:**
- Create: `src/app/[locale]/(app)/invoices/[id]/page.tsx`, `loading.tsx`, `error.tsx`; `src/components/invoices/folder-view.tsx`, `add-invoice-item-form.tsx`, `invoice-item-sheet.tsx`
- Modify: `src/messages/en.json`, `src/messages/ar.json`
- Test: `src/components/invoices/folder-view.test.tsx`

**Interfaces:**
- Consumes: `getInvoiceFolder`, `addItem`, `updateItem`, `deleteItem`, `restoreItem`, `renameFolder`, `deleteFolder`, `totalsByCurrency`, `rowDefinition`, `canAddIn`.
- Produces: `FolderView({ folder }: { folder: InvoiceFolderDetail })`; `useFolderItems(initial: InvoiceItem[])` (a small hook in `folder-view.tsx` holding the optimistic list and an `applyRemote(change)` function that Task 8 calls with `{type: "upsert", item}` or `{type: "delete", id}`).

- [ ] **Step 1: Write failing tests** (EN and AR, `AppDataProvider` as in `items-view.test.tsx`): header shows one stacked total per currency for a mixed folder (`$800.00` and `LBP 2,500,000` for the spec's example) and never one combined number; a row whose currency the viewer has not enabled renders with its code and does not throw (Review Focus 1); a total that cannot be summed shows the "too large to show" text (Review Focus 5); a 60-character Arabic-plus-Latin name does not overflow at 360px (assert `scrollWidth <= clientWidth` on the list); the add form offers only the viewer's enabled currencies and Enter adds the row optimistically then clears; editing any row works, including someone else's; deleting a row shows an Undo toast that calls `restoreItem`; saving a row that returns `conflict` shows "this item was removed" and drops it from the list; "who added" labels appear only when the folder has more than one active person ("You" for the viewer's own rows, the person's name otherwise, "Former member" when `createdBy` has no active member).
- [ ] **Step 2: Run** `pnpm test src/components/invoices/folder-view.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** following `items-view.tsx`, `add-item-form.tsx` and `item-sheet.tsx`, using `SheetShell`/`ConfirmSheet` and `ScreenHeader`. Rename and delete folder appear only for the owner; delete confirms and says the rows go too. Use the stacked-totals layout the owner chose (mockup A). Run the `impeccable` craft floor before editing.
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint` — Expected: PASS.

### Task 7: Sharing UI

**Files:**
- Create: `src/components/invoices/share-sheet.tsx`
- Modify: `src/components/invoices/folder-view.tsx` (Share button in the header; for non-owners a menu item "Leave folder" and a "Your name here" edit), `src/messages/en.json`, `src/messages/ar.json`
- Test: `src/components/invoices/share-sheet.test.tsx`

**Interfaces:**
- Consumes: `createOrRotateLink`, `disableLink`, `removeMember`, `leaveFolder`, `setMyName`, `InvoiceFolderDetail.link` and `.members`.
- Produces: `ShareSheet({ folder }: { folder: InvoiceFolderDetail })`. Link URL format: `${window.location.origin}/${locale}/invoices/join/${token}`.

- [ ] **Step 1: Write failing tests.** Owner without a link sees "Create link"; the first time it asks for the owner's own name (required, 1–30 characters) and passes it to `createOrRotateLink`; with a link: shows it with Copy (uses `navigator.clipboard`, falls back to a selectable field) and Share (uses `navigator.share` when present), "Replace link" and "Turn off link" (each confirms; replacing says the old link stops working); the member list shows names (never emails) with Remove for the owner only, and removal confirms and says their rows stay; a non-owner sees the member list without Remove and a Leave button that confirms and says their rows stay; EN and AR.
- [ ] **Step 2: Run** `pnpm test src/components/invoices/share-sheet.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** with `SheetShell` and `ConfirmSheet`; call `router.refresh()` after each change; after Leave, go to `/invoices`.
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint` — Expected: PASS.

### Task 8: Live updates

**Files:**
- Create: `src/components/invoices/use-live-folder.ts`
- Modify: `src/components/invoices/folder-view.tsx` (use the hook)
- Test: `src/components/invoices/use-live-folder.test.tsx`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/client`; `useFolderItems().applyRemote` from Task 6; `router.refresh()`.
- Produces: `useLiveFolder(folderId: string, handlers: { onItem: (change: {type: "upsert"; item: InvoiceItem} | {type: "delete"; id: string}) => void; onMembers: () => void; onLost: () => void }): { status: "live" | "polling" }`.

- [ ] **Step 1: Write failing tests** with a fake Supabase channel: subscribes once to changes on `invoice_items` filtered by `folder_id=eq.<id>` and on `invoice_folders` for that folder (not `invoice_members`: realtime delete events cannot be filtered by RLS, so members are not published; member changes are learned by a `router.refresh()` every 30 seconds while the tab is visible, and on focus); an insert/update/delete event calls `onItem` with a mapped change; each periodic refresh calls `onMembers`; unsubscribes on unmount; a channel error or close switches `status` to `"polling"` and refetches (via `router.refresh()`) every 5 seconds only while the tab is visible; `visibilitychange` to visible and the `online` event refetch once; when the refetch finds the viewer is no longer a member (the folder page returns the not-found result) `onLost` runs and the screen leaves to `/invoices` with a "You no longer have access to this folder" notice and shows no stale rows (Review Focus 2).
- [ ] **Step 2: Run** `pnpm test src/components/invoices/use-live-folder.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the hook with `supabase.channel(...).on("postgres_changes", ...)`. Realtime delete events carry only the primary key; handle that. Row data in events uses database column names; map to `InvoiceItem`.
- [ ] **Step 4: Run** the tests, `pnpm typecheck`, `pnpm lint` — Expected: PASS.

### Task 9: Docs, end-to-end check and full verification

**Files:**
- Modify: `PRODUCT.md` (add the Invoices feature to the v1 scope list and note that it is a narrow, per-folder exception to "household/shared spaces" being out of v1)
- Create: `e2e/invoices.spec.ts`

**Interfaces:**
- Consumes: everything above (preview mode data from `getInvoiceFolders`/`getInvoiceFolder` demo branches).

- [ ] **Step 1: Write the Playwright spec** in the style of `e2e/items.spec.ts`, EN and AR, all four projects: open Wallets → Invoices; the demo "PC build" folder shows stacked USD and LBP totals; add a row (preview mode shows its "unavailable in preview" message); open Share (preview shows the same notice); take full-page screenshots; assert `document.documentElement.scrollWidth <= innerWidth`.
- [ ] **Step 2: Run** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — Expected: all pass.
- [ ] **Step 3: Run** `pnpm test:e2e e2e/invoices.spec.ts` — Expected: PASS in all projects.
- [ ] **Step 4: With Docker running**, run `pnpm db:reset`, `pnpm db:test`, then exercise the real flow with two synthetic accounts in the browser pane (owner creates a folder and link; second account opens the link, joins, adds a row; the owner sees it without reloading; owner removes them; they lose access and cannot rejoin). Capture 390px screenshots of the list, folder, share sheet and join page in EN and AR for the owner. Remove synthetic accounts and stop the visual-companion server afterwards (`bash scripts/stop-server.sh` in the brainstorming skill folder).
- [ ] **Step 5: Report to the owner** what was verified and what was not (for example, if Docker could not be started the SQL tests did not run).
