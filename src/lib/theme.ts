export type Theme = "system" | "light" | "dark";

const KEY = "theme";

/** Whether the dark class should be on. Keep in sync with `themeScript` in the root layout. */
export function resolveDark(theme: Theme, prefersDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && prefersDark);
}

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Applies the theme to <html> and remembers it on this device. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(
    "dark",
    resolveDark(theme, matchMedia("(prefers-color-scheme: dark)").matches),
  );
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
}

/** Re-applies the stored theme without rewriting it. */
export function syncTheme(): void {
  document.documentElement.classList.toggle(
    "dark",
    resolveDark(readStoredTheme(), matchMedia("(prefers-color-scheme: dark)").matches),
  );
}
