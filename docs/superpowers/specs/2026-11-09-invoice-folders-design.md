# Invoice folders: design

Date: 2026-11-09. Status: draft for the owner's approval.

## Intent and why

The owner keeps an Excel sheet of what they paid for each part of a PC build (columns: item, price). They want that inside the Budget Tracker instead: a **folder** such as "PC build" holding simple rows (CPU 250, GPU 450, case 100) with a total, so the record lives next to the rest of their money. They do not want to import the sheet; they will re-enter what they want to keep.

Later they asked for the folder to be **shareable with other people, who can add to it, like a shared cart**. Sharing is by a **link** the owner sends (for example over WhatsApp). Link was chosen over typing an email because it is the simplest for the owner and does not reveal whether an email has an account.

## Goals

- Create named folders. Each holds rows of: item name, price, currency.
- One folder can mix currencies (USD and LBP, plus SYP). The folder shows **one total per currency, stacked**, and never adds two currencies together. The owner chose this layout over currency tabs (mockup "A").
- Rows can be edited and deleted. Folders can be renamed and deleted (deleting a folder deletes its rows, after a confirmation).
- The owner can share a folder through a link. Anyone who opens the link while signed in joins that folder and can add rows. Signed-out visitors sign in or sign up first, then land in the folder.
- **Shared cart:** everyone in the folder (owner and members) can add, edit and delete any row. When one person changes the folder, the others who have it open see the change appear without reloading (new rows, edited rows, deleted rows, updated totals). If live updates are interrupted, the folder refreshes itself when the person returns to the tab or the connection comes back.
- Each row shows who added it once a folder has more than one person.
- The owner can turn the link off, create a new link (which invalidates the old one), see who is in the folder, and remove a person. A member can leave.

## Non-goals

- Not connected to wallets, balances, Activity, budgets or reports. Adding a row never moves money, and a folder never appears in totals elsewhere. (The owner confirmed: "just tracker".)
- No Excel/CSV import or export of folders.
- No dates, store names, notes, photos or receipts on rows.
- No typing indicators, cursors, comments or chat. "Live" means finished changes show up for the others (see Goals), nothing more.
- No email invitations, roles beyond owner and member, comments, or transferring ownership.

## Anti-goals (a failure even if it technically works)

- A person who joins through a link must never gain access to anything of the owner's other than that one folder: no wallets, Activity, settings or other folders.
- A link that can be guessed, or that keeps working after the owner turned it off.
- Two currencies added into one number, or an amount shown with the wrong decimal places.
- Exposing anyone's email address to other members.

## Decisions the owner made

- Section holds folders; each folder holds name + price rows; the owner enters everything by hand.
- Folders are not tied to wallet spending.
- Items in one folder may be in different currencies.
- Folder total is shown stacked, one row per currency, at the top of the folder.
- Sharing is by a link; every person needs their own account (sign-up is already open).
- Shared cart: everyone in the folder can edit any row, and the others see the edit.

## Calls made by Claude (the owner may override)

- **Name and entry:** the section is called "Invoices". It is a row in the existing list on the Wallets screen (next to Loans, Pending payments and the Item calculator). The bottom bar is unchanged. Routes: `/invoices` (folder list), `/invoices/[id]` (one folder), `/invoices/join/[token]` (opens a share link).
- **Permissions (the owner chose "shared cart, all can edit"):** every person in the folder can add, edit and delete any row. Only the owner can rename or delete the folder, manage the link and remove people. A member can leave. Deleting a row asks for no confirmation but shows an Undo, because anyone can delete anyone's row.
- **Two people at once:** if two people edit the same row, the later save wins and both screens end up showing it. If someone deletes a row another person is editing, the editor gets a plain "this item was removed" message instead of an error. No merge screen.
- **Live updates:** the folder screen listens for changes to that folder only and applies them to what is on screen. It must respect the same access rules as normal reads, so a removed person stops receiving changes. Use the platform's built-in real-time feature of the existing backend if it can enforce those rules; otherwise refresh the open folder every few seconds while it is visible. Builder's choice, but the person must never see changes to a folder they no longer belong to.
- **Link:** at most one active link per folder. The link token is random and long enough that it cannot be guessed. The owner can switch it off (nobody new can join; people already in stay) or replace it. A folder holds at most 20 people besides the owner, so a leaked link cannot grow without bound.
- **Joining twice or the owner opening their own link** is harmless: it just opens the folder.
- **Names:** accounts have no display name today (the profile stores only language, digits, timezone and theme), so each person types a name for themselves in a folder when they join, such as "Karim". The owner's name in their own folders is also asked once, when they first share. Everyone in the folder sees these names next to rows and in the member list; viewers see "You" for their own rows. A person can change their name in that folder later. Email addresses are never shown to anyone. This is Claude's call; the owner did not answer the question.
- **Folder list:** shows each folder with its name, row count, per-currency totals (at most two shown, then "+N", the same way Wallets shows commitments), and a "Shared" marker when it has other people or the viewer is not the owner. Folders the viewer joined appear in the same list.
- **Currencies in shared folders:** each person has their own currency catalog, so a row stores its currency code **and the number of decimal places it was saved with**. Any viewer then formats the amount correctly even if their own catalog differs. A person can only add rows in currencies they have enabled. If a viewer does not have a row's currency enabled, show the number with the plain currency code. Totals group by currency code and decimal places and are never mixed. Money is stored as whole minor units, parsed and formatted only through `src/lib/money.ts` and `src/lib/currency.ts`.
- **Row limits:** name 1 to 60 characters, price between 1 and the app's maximum, as for the existing item calculator.
- **Deleting an account** deletes the folders it owns and removes it from folders it joined.
- **Rows when someone leaves, is removed, or deletes their account:** their rows stay in the folder so the totals do not silently shrink. The author shows as "Former member". Removing or leaving asks for confirmation and says the rows stay.
- **Removed people stay removed:** a person the owner removes cannot rejoin that folder through any link, including a replaced one. (There is no "allow back" in this version.) A person who left on their own can rejoin with a working link.
- **Opening a link asks first:** the join page shows the folder name and a "Join" button; nothing changes until they press it. Any link that does not work (switched off, replaced, unknown, folder full, or the person was removed) shows one generic message, "This link doesn't work. Ask for a new one.", so it never reveals whether a folder exists.
- **Limits:** at most 100 folders per owner and 500 rows per folder, enforced in the database, with a plain error message in both languages.
- **Currencies when editing someone else's row:** a person can edit a row's name and price in the row's own currency (using the decimal places stored with the row) even if they do not have that currency enabled. Changing a row's currency is allowed only to one the editor has enabled. The price maximum is the app's single `MAX_MINOR` limit, as in the item calculator.

## Constraints

- Follow `CLAUDE.md`: mobile first at 390px, English and Arabic with RTL (logical utilities only, `<bdi>` around names and amounts), every string in both `src/messages/en.json` and `ar.json`, skeleton loading, optimistic updates, bottom sheets for dialogs, 44px touch targets, 16px inputs.
- Schema changes only through `supabase/migrations/` with SQL tests. Row Level Security on every table. Reads in Server Components, writes in Server Actions validated with zod, retries must not create duplicate rows (client-generated ids, as the Item calculator does).
- Sharing deliberately changes the rule "each account sees only its own `user_id` rows". The access rule for these tables becomes "owner or member of the folder". `supabase/tests/isolation.test.sql` style tests must prove that a stranger, a removed member and a member of a different folder see nothing, and that a member sees nothing outside the folder.
- Joining a folder must go through a controlled database function, not by letting clients write membership rows directly, so a token is required and the member cap is enforced.
- `PRODUCT.md` lists "household/shared spaces" as out of v1. This feature is a deliberate, narrow exception (one folder at a time); update `PRODUCT.md` to say so.
- Do not commit; the owner commits manually.

## Left to the builder

- Table and column design that satisfies the above (a draft private-only migration and SQL test exist under `supabase/` from before sharing was requested; they are uncommitted and should be replaced).
- Exact UI for the share sheet, member list and "who added this", following `DESIGN.md`. New screens get a screenshot at 390px in English and Arabic for the owner to review before the work is called done.
- How signed-out visitors return to the link after signing in, following however the app already handles redirects.
- Pagination and ordering of rows (newest first, like the Item calculator).
- Preview/demo data when no database is configured, as the Item calculator does, using clearly synthetic data.

## Accepted residuals and follow-ups

Found during review and accepted for this version.

- **Realtime DELETE events.** The delete events Realtime sends carry only the bare row id, and the publication cannot filter deletes, so the ids of deleted rows from all folders reach any signed-in subscriber. A removed member also keeps the live channel for up to 30 seconds, so they can still see deletes of rows they already had. Recommended follow-up: move to private Realtime Broadcast (a database trigger calling `realtime.broadcast_changes` on the topic `invoice-folder:<id>`, with RLS on `realtime.messages` using `is_invoice_member`) and drop `invoice_items` from the publication.
- **Folder ids in Realtime DELETE events.** If Realtime does not apply the `id=eq.` filter to DELETE events, the ids of deleted folders (not only of rows) can also reach subscribers. The client ignores ids that are not its own folder's.
- **Same currency code, different people.** Two people's custom currencies with the same code and decimals are totalled together in a shared folder. Grouping is by code and decimals, by design.
- **Undo squatting (recommended small database hardening).** Reject a non-restore INSERT whose id has a live tombstone. This closes the case where someone who saw a leaked deleted row id takes that id before the original author's Undo.
  - DONE: a non-restore insert of an id whose tombstone is still inside the 10-minute Undo window is refused (42501 `invoices.invalid`, shown as "changed meanwhile") without taking any row lock: `invoice_items_integrity` refuses it before the row is written, and the `invoice_items_a_id_guard` AFTER INSERT trigger (migration 20261201000100) refuses an insert that raced an in-flight delete of that id (it waits on the primary key, then sees the committed tombstone). A consequence is that an add retried after that row was deleted within the window is refused too, whoever deleted it (the person retrying included), while a retry of a live row stays a quiet no-op.
- **Timestamp ordering (recommended database hardening).** `updated_at` uses `now()` (the transaction start), so two overlapping writes to one row can commit in the opposite order of their timestamps. Use `greatest(clock_timestamp(), old.updated_at + 1 microsecond)` together with a microsecond-aware compare.
  - DONE: updates of items and folders set `updated_at` to `greatest(clock_timestamp(), old.updated_at + 1 microsecond)` (restored rows keep their saved times), and the folder screen compares versions to the microsecond.
- **Known gaps.**
  - A signed-in person who has not finished onboarding and opens a link directly, or who confirms their email in a different browser, loses the remembered link and has to open it again.
  - A removed person learns of the removal within about 30 seconds.
  - Rows deleted by someone else while Realtime is down can linger until the next refresh.
