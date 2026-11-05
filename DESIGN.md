---
name: Budget Tracker
description: Encaustic-tile budget tracker, teal shell on limestone, marigold only for Add, oxblood only for over-budget.
colors:
  limestone: "#eceeea"
  ink: "#14211f"
  card: "#ffffff"
  teal-shell: "#0f4c4a"
  shell-foreground: "#f4f7f3"
  shell-muted: "#b9d2ce"
  sage-mist: "#e1e7e1"
  sage-wash: "#dce5df"
  muted-ink: "#4f625f"
  grout: "#d3dad4"
  field-edge: "#7e918c"
  marigold: "#f2b632"
  oxblood-alert: "#a3302a"
  over-soft: "#f6e3e1"
  over-ink: "#6f1d18"
  positive-green: "#1f7a4d"
  tile-oxblood: "#8e2f3a"
  tile-ochre: "#b07a00"
  dark-background: "#0b1514"
  dark-card: "#13211f"
  dark-primary: "#4fb0a6"
  dark-shell: "#0e3f3d"
  dark-over: "#f0877f"
typography:
  hero:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Readex Pro, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  cell: "3px"
  sm: "6px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  sheet: "28px"
spacing:
  hairline: "3px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  page: "16px"
  section: "24px"
components:
  button-default:
    backgroundColor: "{colors.teal-shell}"
    textColor: "{colors.shell-foreground}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 16px"
  button-action:
    backgroundColor: "{colors.marigold}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
  button-action-lg:
    backgroundColor: "{colors.marigold}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    height: "56px"
    padding: "0 24px"
  button-outline:
    backgroundColor: "{colors.limestone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.sage-mist}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
  category-glyph:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
    size: "40px"
  list-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    height: "60px"
    padding: "8px 14px"
  over-alert:
    backgroundColor: "{colors.over-soft}"
    textColor: "{colors.over-ink}"
    rounded: "{rounded.xl}"
    padding: "12px 14px"
  keypad-key:
    backgroundColor: "{colors.sage-mist}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "56px"
  segmented:
    backgroundColor: "{colors.sage-mist}"
    rounded: "{rounded.xl}"
    padding: "4px"
  segmented-selected:
    backgroundColor: "{colors.teal-shell}"
    textColor: "{colors.shell-foreground}"
    rounded: "{rounded.lg}"
    height: "44px"
  sheet:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.sheet}"
---

# Design System: Budget Tracker

## Overview

**Creative North Star: "The Encaustic Floor"**

A Lebanese cement-tile floor: a deep teal shell laid over cool limestone, white surfaces set into it like inlays, and tile motifs doing the work other apps give to icon sets and progress bars. Every category owns a geometric tile and a tile colour; every budget is a row of cells that fill. The look is quiet, matte and dense enough for one-handed use at 390px, with colour held back so the two meaningful signals stay loud.

Two hues carry meaning and are rationed. Marigold marks the one thing you can do next (Add and its save/confirm twin in the sheet). Oxblood-red marks over-budget and nothing else, and never travels without an icon and words. Everything else is teal, ink and limestone. English and Arabic share one family (Readex Pro) so mixed lines match; layout is logical-property only so RTL is the same design, not a port.

**Key Characteristics:**
- Teal shell block at the top of a screen, limestone ground, white card inlays with 1px grout borders.
- Eight tile motifs in three tile colours (teal, oxblood, ochre) as category identity.
- Progress is tile cells (16 per bar), never a smooth fill.
- Flat: depth comes from tonal layering and borders, almost no shadow.
- One typeface, five sizes, tabular figures for money.
- Dark theme exists but is provisional.

## Colors

Cool limestone and deep teal, two rationed signal hues, tile colours reserved for category identity.

### Primary
- **Teal Shell** (#0f4c4a): the shell block, default button, selected segment, focus ring, bar fill on cards, links, caret and accent-color.
- **Shell Mist** (#b9d2ce) and **Shell Paper** (#f4f7f3): secondary and primary text on the shell. Bar cells on the shell are Shell Cell On (#e6f0ed) over white at 16% opacity.

### Secondary
- **Marigold** (#f2b632): the Add action only, with ink (#14211f) text. Used by `Button variant="action"`: the centre Add button and the sheet's Save.

### Tertiary
- **Oxblood Alert** (#a3302a): over-budget only. Soft fill #f6e3e1, text #6f1d18. Appears as the alert strip, the "Over" label and the last two bar cells. Always an icon plus text.
- **Tile Oxblood** (#8e2f3a) and **Tile Ochre** (#b07a00): category tile colours with Teal, used only through the category glyph. They are not alert or action colours.
- **Positive Green** (#1f7a4d): defined for positive balances; not yet exercised in the kitchen sink.

### Neutral
- **Limestone** (#eceeea): page ground. **Card** (#ffffff): inlays, sheet, popovers.
- **Ink** (#14211f): text. **Muted Ink** (#4f625f): secondary text.
- **Sage Mist** (#e1e7e1) and **Sage Wash** (#dce5df): secondary/muted fills (segmented track, keypad, skeleton uses Sage Wash), pressed states.
- **Grout** (#d3dad4): borders, dividers, empty bar cells. **Field Edge** (#7e918c): input borders.

### Dark (provisional)
Background #0b1514, card #13211f, primary #4fb0a6, shell #0e3f3d, over #f0877f, tile colours lifted (#4fb0a6, #d98591, #e0b13a). Marigold is unchanged. Values are untested against the full app and may change; do not copy them into new work as settled.

### Named Rules
**The One Next Thing Rule.** Marigold appears only on the Add action. Nothing else on a screen may be marigold, not badges, highlights or selected states.
**The Change-Only Alert Rule.** Oxblood-red means over-budget. It is never decoration, never an error colour for other states, and never colour alone: icon plus text every time.
**The Tile Colour Rule.** Teal, oxblood and ochre tiles identify categories. A tile in oxblood does not mean over.

## Typography

**Display, Body and Label Font:** Readex Pro (latin + arabic subsets, `--font-sans`, swap), one family for all roles.

**Character:** Open, geometric and even in both scripts, so Arabic lines sit level with Latin ones.

### Hierarchy
- **Hero** (700, 40px, 1.1, -0.025em): the left-to-spend USD amount on the shell.
- **Headline** (700, 28px, tight): the LBP amount on the shell, and the currency prefix in the entry sheet.
- **Title** (600, 17px): section headings and sheet title.
- **Body** (400/500, 15px): lead sentences, buttons, alert text, segmented labels. Row names inherit 16px base at weight 500.
- **Label** (400, 13px): secondary lines, spent/of captions, over label (600).

Also in use: 46px/700 for the amount being typed in the sheet, 24px/600 on keypad keys, 18px for wallet amounts and the shell title, 12px/500 under category picker tiles, 16px minimum for form inputs.

### Named Rules
**The Tabular Rule.** Every amount uses tabular figures (the `amount` class); body text does not.
**The Latin Digits Rule.** Digits stay Latin in Arabic.

## Layout

Mobile first at 390px; base classes are the phone, `sm/md/lg` add. Page gutter 16px, section gap 24px, card inner padding 14px, list rows at least 60px tall, wallet cards 72px tall and scroll horizontally with snap. Screens open with the teal shell block under the status bar, then limestone content. The kitchen sink caps content at 560px. Fixed bars respect `env(safe-area-inset-*)` via `--safe-top` and `--safe-bottom`; full-height uses `min-h-dvh`; no horizontal overflow except deliberate snap strips. Touch targets are at least 44px (every Button size). The five-column bottom bar with raised marigold Add and the desktop sidebar are specified in docs/MOBILE-UX.md and not part of the kitchen-sink artifact.

## Elevation & Depth

Flat and tonal. Depth is a white card on limestone with a 1px Grout border, and the shell as a darker block. The only shadow in the system is the action button's `shadow-sm`. The sheet is separated by a top border and a 10% black backdrop with a light blur. No hard offset shadows, no glows.

### Named Rules
**The Flat Inlay Rule.** Surfaces are set into the ground with borders and tone, never lifted with shadow.

## Shapes

Tile geometry softened by modest radii: 3px bar cells, 6px small, 10px glyph chips (`rounded-md`), 12px buttons, 16px (`rounded-xl`) cards, lists, alert, segmented track and large buttons, 28px (`rounded-t-3xl`) top corners on the sheet. Category glyphs are a 40px square chip: a 30px tile motif in the tile colour on a 10% tint of that colour with a 28% tint border. Pills (`rounded-full`) are used for the wallet selector in the sheet.

## Components

### Buttons
All sizes are at least 44px tall (default 44, lg 56, icon 44, icon-lg 48). Radius 12px, large 16px, text 15px, medium weight.
- **Default:** Teal Shell, Shell Paper text, 90% on hover.
- **Action:** Marigold, ink text, semibold, `shadow-sm`, brightness 95% on hover. Add and Save only.
- **Outline, Secondary, Ghost, Destructive, Link:** border Grout on limestone; Sage Mist fill; transparent with muted hover; destructive tint 10%; teal underline link.
- Focus is a 2px teal ring at 50% plus border; press moves 1px down. Disabled is 50% opacity.

### TileBar
A row of 16 cells, 14px tall, 3px gap, 3px radius, `role="meter"`, always LTR. Cells fill by round(value*16); on over-budget the last two cells turn Oxblood Alert. Variants for card (empty Grout, on Teal) and shell (translucent white, pale on). Cell colour changes ease over 300ms. The caller must also show the numbers and, when over, an icon and "Over".

### CategoryGlyph and TileGlyph
Eight SVG motifs (diamond, flower, nested squares, star, chevrons, four circles, hexagon, pinwheel), decorative (`aria-hidden`), always next to the category name.

### Amount
`<bdi dir="ltr" class="amount">`: tabular, LTR, isolated, no wrap, in every locale. Names use plain `<bdi>`.

### AmountKeypad
3-column grid, 6px gap, keys 56px tall, 12px radius, Sage Mist fill, 24px semibold, `dir="ltr"` so it never mirrors. Bottom row is "." for currencies with fractional precision or "000" for zero-decimal currencies, 0, then a backspace icon in muted ink.

### Segmented
Native radio group in a Sage Mist track (16px radius, 4px padding); segments 44px, 15px; selected is Teal Shell with Shell Paper semibold text. Arrow keys follow RTL from the browser.

### Drawer sheet
Base UI Drawer from the bottom: card fill, 28px top corners, max height 100dvh minus 6rem, 450ms ease `cubic-bezier(0.22,1,0.36,1)` slide, swipe to dismiss. Content scrolls; the footer (top border, card fill, safe-area padding) pins the full-width large marigold Save. Add flow order: title and close, kind segmented, typed amount (46px) with wallet pill, 4-column category picker (78px min tiles, selected gets 2px ink border and Sage Wash), keypad.

### List row
Min 60px, 14px side padding, 1px Grout divider, glyph, name (500) over 13px muted sub line, amount (semibold) at the end. Rows sit in a 16px-radius white card with a Grout border.

### Over-budget alert
Oxblood-soft strip, 16px radius, triangle-alert icon in Oxblood Alert, 15px text in over-ink with the amount, and a 44px "See budget" underlined action pushed to the end (`ms-auto`). `role="status"`.

### Skeleton
Sage Wash block, 6px radius, pulse. Used for loading; no "Loading..." text.

### Motion
Short, functional: 300ms cell colour, 450ms sheet, `--ease-out-expo` token defined. `prefers-reduced-motion` collapses all animation and transition to 0.01ms.

## Do's and Don'ts

### Do:
- **Do** use logical utilities only (`ms-`, `pe-`, `start-`, `text-start`).
- **Do** wrap amounts in `Amount` and names in `<bdi>`; keep the keypad and TileBar `dir="ltr"`.
- **Do** pair every oxblood-red use with the triangle-alert icon and the word "Over".
- **Do** keep targets at 44px or more and inputs at 16px or more.
- **Do** reach for a tile motif and tile colour to identify a category.

### Don't:
- **Don't** use marigold anywhere except the Add action and its Save twin.
- **Don't** use oxblood-red for non-budget errors or decoration, or without icon and text.
- **Don't** replace the tile bar with a smooth progress bar, or lead with a hero-metric card.
- **Don't** add or compare USD with LBP in any visual treatment; each currency has its own bar.
- **Don't** treat the dark tokens as final, or the planned tile-pattern band and tile ornament empty state as built (planned for Phase 2, absent from the build).

## Currency and wallet interaction

The Wallets screen presents a global Currency selector and one shared wallet list. Each row shows that currency's amount and the wallet's saved default; the selected display currency never changes that default. Every enabled currency is present in every ordinary wallet, using catalog order consistently. Reordering uses a dedicated 44px handle with pointer, keyboard pickup/move/drop/cancel and localized live announcements. A failed save restores the complete authoritative order.

Money pickers first choose the wallet container, then its exact currency balance. Move excludes the source container; Exchange stays within it and excludes the source currency. The keypad and editable amounts follow the runtime 0–8-place definition. Format money as isolated LTR text in both locales, without a combined currency total. Kitchen-sink samples include an eight-place BTC definition.

Currency disable presents explicit blockers or a confirmation before switching defaults. Re-enable retains identities. Permanent wallet deletion presents each nonzero balance and its required same-currency counterpart, including negative balances, with one atomic confirmation. Disabled and deleted history remains readable. These screens must remain usable in Arabic RTL and English at 320px without horizontal overflow.
