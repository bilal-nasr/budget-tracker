# Mobile UX & Responsiveness Spec

The phone is the product. This document defines layout, navigation, interaction and responsive behaviour. It is **not** the visual identity: colours, fonts, radii and illustration style are decided in Phase 1 and recorded in `DESIGN.md`. Where this file says "accent" or "surface", it means the tokens `DESIGN.md` will define.

Every UI change is checked against §12 before it is called done.

---

## 1. Target devices

| Class | Design viewport | Notes |
| --- | --- | --- |
| Floor | 320 × 568 | Small Android / iPhone SE 1st gen. Must work, may be tight. |
| **Primary** | **390 × 844** | iPhone 13–16. Designs are drawn here first. |
| Large phone | 430 × 932 | Pro Max / large Android. |
| Tablet | 768 × 1024 | Portrait iPad, foldables unfolded. |
| Desktop | 1280 × 800+ | Month-end review sessions. |

Also test landscape phone (844 × 390): the add sheet and sign-in must stay usable.

## 2. Breakpoints & layout modes

Mobile-first: base styles are the phone; larger screens add.

| Tailwind | Width | Navigation | Content |
| --- | --- | --- | --- |
| base | < 640 | Bottom tab bar + centre Add | Single column, 16px gutters |
| `sm` | ≥ 640 | Bottom tab bar | Single column, 24px gutters, max-width 560 centred |
| `md` | ≥ 768 | Side **rail** (icons + short labels, 80px) | Single column, max-width 640 |
| `lg` | ≥ 1024 | **Sidebar** (240px, labels, Add button at top) | Two columns where useful (list + detail, chart + table), max-width 1120 |

Use **container queries** (`@container`) for components that live in different widths (summary cards, budget rows, charts), so they respond to their slot, not the viewport.

## 3. App shell

```
┌──────────────────────────────┐  ← safe-area-inset-top
│ TopBar: title · month · ⚙    │  56px, sticky, compact on scroll
├──────────────────────────────┤
│                              │
│   scrolling content          │  padding-bottom = tabbar + inset + 16
│                              │
├──────────────────────────────┤
│ Home  Activity  (+)  Budgets  Wallets │  64px + safe-area-inset-bottom
└──────────────────────────────┘
```

- **Four destinations + Add**: Home · Activity · **Add** · Budgets · Wallets. Reports open from Home ("See report") and from the sidebar on desktop; Settings from the TopBar gear. Never more than 5 items in the bar.
- **Add** is a raised centre button (56px, accent) in the tab bar, with a visible "Add" label for clarity. On `md`, Add sits at the top of the rail; on `lg`, a primary button at the top of the sidebar. Keyboard shortcut `N` on desktop.
- Active tab: icon fill + label weight + indicator; never colour alone. `aria-current="page"`.
- The tab bar hides while the on-screen keyboard is open (see §7) and never hides on scroll (predictability beats 64px).
- TopBar: page title on the start side; on Home/Budgets/Reports a **month switcher** (‹ November 2026 ›) with swipe-left/right on the summary card as a shortcut; gear icon on the end side.
- Layout units: `min-h-dvh`, never `100vh`. Fixed bars use `env(safe-area-inset-*)`.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`. Do not disable zoom.
- `theme-color` meta per colour scheme so the status bar matches.

## 4. Screens (mobile-first content order)

Each screen leads with **one answer**, then detail on request (principle 2 in `PRODUCT.md`).

### Home
1. **Left to spend this month**: one large number per currency (USD row, LBP row only if the user has LBP wallets/budgets), with spent/budget and a single progress bar each.
2. **Over-budget callout**: only when something is over: "Groceries is $40 over", with a tap target to that budget.
3. **Recent activity**: last 5 transactions, "See all" → Activity.
4. **Wallets strip**: horizontally scrollable chips with balances (scroll-snap, visible overflow hint, no hidden scrollbar trap on desktop).
5. "See this month's report" link.

### Add (sheet; the most important screen, see §5)

### Activity (transactions)
- Search field (sticky under TopBar) + filter chips: All · Expenses · Income · Transfers; "Filters" button opens a sheet for wallet, category, date range.
- List grouped by day with **sticky day headers** showing the day total per currency.
- Row (min 56px): category icon · name/note (truncate 1 line) · wallet (secondary line) · amount on the end side (expense neutral/negative style, income positive style, both with sign text).
- Tap row → detail sheet (Edit, Duplicate, Delete). No swipe-to-delete in v1 (hidden, conflicts with iOS back-swipe and RTL); may be added later as a shortcut, never the only path.
- Cursor pagination, 30 per page, auto-load near bottom + a visible "Load more" button fallback. Never silently truncate.
- Empty state: one sentence + "Add your first expense" button.

### Budgets
- Month switcher. Per currency a segmented control (USD | LBP) when both exist.
- Summary: budgeted · spent · left.
- One row per category: icon, name, `spent / limit`, bar with over-limit state (icon + text, not colour only). Tap → category month detail (transactions in that category + edit limit).
- "Edit budgets" opens a full-height sheet: one list of categories with amount inputs, a running total at the bottom, sticky Save. Categories without a limit are listed under "No limit" and stay one tap away.
- New month: limits carry forward automatically; a dismissible note says so.

### Wallets
- Grouped by currency with a total per currency (never combined). Optional "≈" total in the other currency if a reference rate exists.
- Row: icon, name, kind, balance. Tap → wallet detail (balance, its transactions, Edit, Archive).
- "Add wallet" button at the end of each list and in the empty state.
- "Move money" action (transfer / exchange) from the wallet detail, prefilled.

### Reports
- Month switcher, currency switch.
- Donut (spending by category) with a full **text legend/table** below it (amount + %); tapping a slice or legend row highlights both and links to filtered Activity.
- 6-month bar chart of spending; tap a bar for exact values. Horizontal scroll within the chart container if needed; the page never scrolls sideways.

### Settings
Language (English / العربية), digits (Latin / Arabic-Indic), theme (System / Light / Dark), default wallet, reference rate (LBP per USD), categories manager, sign out, app version.

### Sign-in
Single card: app name, email, password, "Sign in". Large inputs, `autocomplete="username"` / `"current-password"` so the phone's password manager fills it. No sign-up link.

### First run (onboarding, 3 steps, skippable after step 2)
1. Language. 2. First wallet (name, USD/LBP, current balance; "I have this money" / "I owe this money" choice instead of a negative-sign checkbox). 3. Optional: set 3 budgets from suggested categories. Then land on Home with a coach mark on Add.

## 5. The Add flow (ten-second logging)

Target: **open app → Add → amount → category → saved** in ≤ 4 taps plus typing the amount.

- Opens as a **bottom sheet** (vaul Drawer) on phones, a centered dialog on `md+`. Same component, responsive container.
- Top: segmented **Expense · Income · Move** (Move = transfer or exchange, chosen by picking the destination wallet; if its currency differs, a second amount field "You received" appears).
- **Amount first**, large (40px+), autofocused, with the currency of the selected wallet shown beside it. Tap the currency/wallet pill to switch wallet.
- **Category grid**: 8 most-used categories as 4×2 big tiles (≥ 64px), then "More". Selecting a category with a valid amount enables Save.
- Defaults: wallet = last used (or profile default), date = today, note empty. Date and note sit in a collapsed "Details" row (one tap to expand). Date shows "Today / Yesterday / pick".
- **Save** is a full-width primary button pinned to the bottom of the sheet, above the keyboard and safe area.
- After save: sheet closes, a toast "Saved · Undo" for 5s, the new row appears in lists via optimistic update with no jump (animate height from 0). "Add another" option: long-press Save or a toggle "Keep open".
- Amount entry: decide in Phase 1 mockups between
  - **A. Native keyboard**: `inputMode="decimal"`, `enterKeyHint="next"`; simplest, accessible.
  - **B. In-sheet keypad** on coarse pointers (3×4 grid, 56px keys, "000" key for LBP): no keyboard covering the sheet, faster for LBP's large numbers. Hardware keyboard and paste still work.
  Recommendation: **B on touch devices, A on desktop**, validated with a real-phone prototype.
- Contextual add: opening Add from a budget row pre-selects that category; from a wallet pre-selects that wallet.
- PWA shortcut and `/add?kind=expense` URL open the app straight into the sheet.

## 6. Sheets, dialogs, overlays

- Phone: everything modal is a **bottom sheet** with a drag handle, swipe-down to dismiss, a visible close button (not gesture-only), max-height `90dvh`, internal scroll, sticky footer for the primary action.
- `md+`: the same content renders in a centered dialog (max-width 480) or, on `lg`, a side panel for transaction details.
- Focus is trapped, returns to the opener on close; `Escape` closes; the background is `inert`.
- Destructive confirms use a small sheet with the consequence spelled out ("Delete this $12.00 expense?"), but prefer **undo over confirm** for single-item deletes.
- Detail routes are deep-linkable (`/transactions/[id]`) and opened as a sheet via intercepting routes, so back/forward and sharing just work.

## 7. Keyboard & input on phones

- `interactive-widget=resizes-content` plus a `visualViewport` fallback hook so sticky sheet footers sit above the keyboard on iOS Safari.
- Tab bar hides while an input in a sheet has focus.
- Correct `inputMode`, `autocomplete`, `enterKeyHint` on every field; amounts never use `type="number"` (scroll-wheel and locale bugs).
- Inputs are ≥ 16px font size so iOS doesn't zoom on focus.
- Scroll the focused field into view with `scroll-margin-bottom` matching the footer height.

## 8. Touch, gestures, thumb zone

- All targets ≥ 44 × 44px with ≥ 8px between adjacent targets; list rows ≥ 56px; category tiles ≥ 64px.
- Primary actions live in the bottom third (tab bar Add, sheet Save). Top-area actions are secondary (gear, filters).
- Gestures are always shortcuts, never the only path: swipe on the month card ⇄ arrow buttons; swipe-down on sheet ⇄ close button.
- `touch-action: manipulation` on buttons (no double-tap zoom delay); `overscroll-behavior: contain` inside sheets and scrollable strips.
- Visible pressed state on every tappable element (scale or tint), no reliance on hover. `@media (hover: hover)` gates hover styles.

## 9. Content & numbers

- Amounts: `tabular-nums`, wrapped in `<bdi dir="ltr">`, sign as text (−/+) in addition to tone. Never mirrored in RTL.
- Large LBP numbers: compact on narrow cards (`LBP 1.2M`) with the full value in the detail and accessible name; never truncate with an ellipsis.
- Text truncation: names truncate to one line with full text in the detail view; amounts never truncate. Test with long Arabic names and 10-digit LBP amounts.
- Dates relative where helpful ("Today", "Yesterday", weekday this week), absolute otherwise, localised.

## 10. RTL

- Built with logical properties only (see `docs/ARCHITECTURE.md` §7). The whole shell mirrors: tab order, rail side, sheet close button, chevrons, swipe direction for month switching (swipe toward "next" follows reading direction).
- Things that do **not** mirror: numbers, amounts, charts' time axis, media controls, the checkmark icon.
- Every screen is reviewed in Arabic at 390px before it ships. Mixed-direction strings (Arabic note with English shop name) are wrapped in `<bdi>`.

## 11. States, feedback, motion

- **Loading:** route-level `loading.tsx` skeletons that match the final layout (no "Loading…" text, no layout jump when data arrives).
- **Optimistic updates** for add/edit/delete with rollback + error toast on failure.
- **Errors:** inline under the field (`role="alert"`) for validation; a retry block for failed sections; offline banner when `navigator.onLine` is false.
- **Empty states:** one sentence + one primary action.
- **Motion:** 150–250ms, ease-out; sheet slide, row insert height animation, progress bar fill. All wrapped in `motion-safe:`; `prefers-reduced-motion` gets instant changes. No parallax, no bounce on data.
- **Haptics:** `navigator.vibrate(10)` on save where supported (Android); silent no-op elsewhere.

## 12. PWA

- Manifest: name, short_name, `display: standalone`, `start_url: /?source=pwa`, scope = base path, icons 192/512 + maskable, `theme_color`/`background_color` from DESIGN.md tokens.
- Shortcuts: "Add expense" (`/add?kind=expense`), "Add income".
- Service worker: precache the app shell and fonts; network-first for data with a cached fallback so the last-seen Home and Activity open offline (read-only). Offline add queue is a Phase 7+ item.
- iOS: `apple-touch-icon`, `apple-mobile-web-app-capable`, status bar style; standalone layout tested on a real iPhone (safe areas, rubber-band scroll).
- Install prompt: a quiet "Install app" row in Settings (and a one-time hint on Home after 3 visits on Android). No interstitials.

## 13. Accessibility

WCAG 2.2 AA: contrast ≥ 4.5:1 text / 3:1 UI; focus visible (2px ring, offset) and not obscured by sticky bars (`scroll-padding`); every icon button has an accessible name; charts have text equivalents; dynamic type up to 200% without loss (layouts wrap, never clip); screen-reader pass with VoiceOver (iOS) and TalkBack (Android) on Add, Activity, Budgets.

## 14. Definition of done (every UI change)

1. Works at **320, 390, 430, 768, 1280** px; no horizontal page scroll at any of them.
2. Checked in **English and Arabic**, **light and dark**.
3. Touch targets ≥ 44px; primary action reachable by thumb.
4. Keyboard open: primary action still visible; nothing important hidden behind the keyboard or tab bar.
5. Loading, empty and error states exist and match the layout.
6. Playwright mobile projects + axe pass; screenshots reviewed (not just the code).
7. Reduced-motion respected; no layout shift on data arrival.

## 15. Owner feedback round 3 flows

- **Categories:** Settings opens the category manager. Names can be English, Arabic or both, with the other language as fallback. Used categories keep their history through archive/restore; live templates need reassignment first. Archived budget limits remain visible until explicitly cleared.
- **Expense breakdown:** Optional one-level description/amount rows explain one expense. Keep the parent Name and full cost. Show an unitemized remainder rather than forcing a complete list; item amounts never create another debit or independently change category spending.
- **Move:** Compact, visibly labelled FROM/TO wallet dropdowns show wallet name and currency. Use two columns where they fit and stack on narrow screens/large text. Cross-currency Received begins read-only. A labelled pencil button enables manual text entry and focuses the input synchronously; Use rate returns supported pairs to locked calculation. SYP pairs without a rate require explicit actual received entry. Pair changes clear stale values; same-pair rate edits preserve manual drafts.
- **Cashier change:** Optional payment/change fields keep purchase cost, money handed over and returned change distinct. Show both wallets and currencies, require an active wallet for returned change, and explain how to create a missing-currency wallet. Confirm a transaction-specific rate for cross-currency reconciliation. Changing or undoing the purchase changes all its wallet effects together.
- **Installments:** Paid/Part paid belongs to the current salary receipt, not the calendar month. Pay again requires a deliberate confirmation; remaining principal and monthly spending never reset with salary. A backdated accounting date does not silently move a payment to another salary cycle.
- **Loans:** Reach Loans from Wallets. Separate borrowed from lent totals and keep currencies separate. Preview principal, the additive one-time fee and total due. Explicitly choose principal moving now or an existing loan with no new wallet movement. Repayments preview principal-first allocation and only fee portions count as spending/income.
- **Numeric editing:** Labels follow the page language; numeric text editing stays LTR with bidi isolation and text selection. Numeric inputs opt touch caret gestures out of sheet dismissal. Store raw drafts synchronously; parse separately. Empty/partial values remain correctable. Never require select-all to delete, force the caret on each render, or format digits back into a live draft. Due-day inputs accept supported digit scripts without filtering typed text.

Automated Chromium/WebKit mobile checks complement physical iPhone/Android keyboard validation. Browser emulation alone does not certify native keyboard behavior. Every new screen and expanded sheet still meets section 14.
