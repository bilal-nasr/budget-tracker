# 02 · Language switch speed and theme loss

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** Switching English ↔ Arabic feels immediate and keeps the dark theme (saved Dark, or System on a dark phone).

**Owner note:** "When changing English to Arabic or vice versa it is taking a while to toggle and the theme is switching to light even if it is on the system theme."

**Architecture:** Two causes in the current code:

- **Slow:** the language `Segmented` in `src/app/[locale]/(app)/settings/settings-form.tsx` runs `updateProfile({ locale })` (which revalidates the whole layout), then `router.refresh()`, and at the same time `router.replace(pathname, { locale })`. That is three server renders for one tap, and the first two render the *old* language.
- **Theme lost:** `/en` → `/ar` changes the `[locale]` root layout segment, so React re-creates `<html>` from server markup that has no `dark` class. The theme is applied only by the `beforeInteractive` script in `src/app/[locale]/layout.tsx`, which runs on the first page load and never again on client navigation. Nothing listens for the phone switching between light and dark either.

Fix: a small client `ThemeSync` in the root layout re-applies the stored theme whenever the locale changes and follows the system setting; the language switch does one navigation and saves the preference without re-rendering.

**Tech stack:** next-intl 4 navigation, React 19 `useLayoutEffect`, `matchMedia`.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task).

## Review focus

- System theme + phone in dark mode + switch language: must stay dark with no light flash.
- Saved Dark + switch language, and saved Light on a dark phone: each keeps its theme.
- The phone flips light/dark while the app is open on System: the app follows without reload.
- The month (`?month=`) and Activity filters in the URL survive a language switch if done from those screens (settings has none today, but `router.replace` must pass the current search params).
- `localStorage` throws in private mode: every read/write stays in `try/catch` (as today).

---

### Task 1: Theme helpers with tests

**Files:**
- Create: `src/lib/theme.ts`, `src/lib/theme.test.ts`
- Modify: `src/app/[locale]/(app)/settings/settings-form.tsx` (import `applyTheme` from here, delete the local copy)

**Interfaces:**
- Produces:
  - `type Theme = "system" | "light" | "dark"`
  - `resolveDark(theme: Theme, prefersDark: boolean): boolean`
  - `readStoredTheme(): Theme` (localStorage key `"theme"`, invalid or missing → `"system"`)
  - `applyTheme(theme: Theme): void` (toggles `dark` on `document.documentElement`, stores the theme)

- [ ] **Step 1: Write the failing test** `src/lib/theme.test.ts`:

```ts
expect(resolveDark("system", true)).toBe(true);
expect(resolveDark("system", false)).toBe(false);
expect(resolveDark("dark", false)).toBe(true);
expect(resolveDark("light", true)).toBe(false);
```

- [ ] **Step 2:** `pnpm test src/lib/theme.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the three functions. `themeScript` in the root layout keeps its inline string (it must run before React), but its logic must match `resolveDark`.
- [ ] **Step 4:** Re-run. Expected: PASS.

### Task 2: Theme survives the language switch

**Files:**
- Create: `src/components/providers/theme-sync.tsx`, `e2e/prefs.spec.ts`
- Modify: `src/app/[locale]/layout.tsx` (render `<ThemeSync />` inside `<body>`, before `NextIntlClientProvider`)

**Interfaces:**
- Produces: `ThemeSync(): null`. `useLayoutEffect` keyed on `useLocale()` calls `applyTheme(readStoredTheme())` (runs before paint, so no flash); a second effect subscribes to `matchMedia("(prefers-color-scheme: dark)")` `change` and re-applies when the stored theme is `system`.

- [ ] **Step 1: Write the failing tests** `e2e/prefs.spec.ts`:

```ts
test("system theme on a dark phone stays dark after switching to Arabic", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/en/settings");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByRole("radio", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar\/settings/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("saved Dark stays dark on a light phone after switching language", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en/settings");
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("radio", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar\/settings/);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("System follows the phone when it changes while the app is open", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en/settings");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});
```

(Adjust the radio names to the real `Segmented` labels from `en.json` → `Settings.themeDark`.)

- [ ] **Step 2:** `pnpm test:e2e e2e/prefs.spec.ts`. Expected: first and third FAIL.
- [ ] **Step 3:** Implement `ThemeSync` and render it.
- [ ] **Step 4:** Re-run. Expected: PASS on all four Playwright projects.

### Task 3: One navigation per language tap

**Files:**
- Modify: `src/app/[locale]/(app)/settings/settings-form.tsx`, `src/features/profile/actions.ts`
- Test: `e2e/prefs.spec.ts`

**Interfaces:**
- Produces: `saveLocale(locale: "en" | "ar"): Promise<ActionResult>` in `src/features/profile/actions.ts`. Validates with `z.enum(routing.locales)`, updates `profiles.locale`, and **does not** call `revalidatePath` (the navigation already renders the new language).

- [ ] **Step 1: Write the failing test** in `e2e/prefs.spec.ts`: count document/RSC requests while switching; expect exactly one request to `/ar/settings` and none to `/en/settings` after the click.

```ts
const hits: string[] = [];
page.on("request", (r) => { if (r.url().includes("/settings")) hits.push(new URL(r.url()).pathname); });
await page.getByRole("radio", { name: "العربية" }).click();
await expect(page).toHaveURL(/\/ar\/settings/);
expect(hits.filter((p) => p.startsWith("/en/"))).toHaveLength(0);
```

- [ ] **Step 2:** Run it. Expected: FAIL (the refresh hits `/en/settings`).
- [ ] **Step 3:** In the language `onChange`: `startTransition(() => router.replace({ pathname, query: Object.fromEntries(searchParams) }, { locale: next }))` and fire `void saveLocale(next)` without awaiting or refreshing. Drop `router.refresh()` from `save()` for digits and theme too: theme is applied on the client; digits change is rendered by the action's `revalidatePath`. Show the pending state on the Segmented (`aria-busy`) while the transition runs.
- [ ] **Step 4:** Re-run `e2e/prefs.spec.ts` and the existing language-switch test in `e2e/smoke.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Live check on `pnpm build && pnpm start`, Fast 4G: tap to Arabic layout under ~500ms, no light flash in dark mode.

## Decisions made for the owner

- `next-themes` (already installed for the toaster) is not adopted: the bug is the missing re-apply after the root segment changes, and a 20-line component fixes it without a provider rewrite.
- The theme stays per device (localStorage), as today. The profile `theme` column keeps being saved for a future "same theme on all devices" option.
