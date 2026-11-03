"use client";

import { useEffect, useLayoutEffect } from "react";
import { useLocale } from "next-intl";
import { readStoredTheme, syncTheme } from "@/lib/theme";

/**
 * Keeps the dark class right after the page changes language (the root layout
 * segment is re-created, which drops it) and while the phone flips between
 * light and dark on the System setting.
 */
export function ThemeSync() {
  const locale = useLocale();

  useLayoutEffect(() => {
    syncTheme();
  }, [locale]);

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredTheme() === "system") syncTheme();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return null;
}
