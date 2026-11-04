import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ar"],
  defaultLocale: "en",
  // Shared by middleware and language-switch navigation; survive browser restarts.
  localeCookie: {
    name: "NEXT_LOCALE",
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  },
});

export type Locale = (typeof routing.locales)[number];

export const isRtl = (locale: string) => locale === "ar";
