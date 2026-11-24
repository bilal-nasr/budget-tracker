import { NextResponse, type NextRequest } from "next/server";
import { siteBase } from "@/features/auth/redirect";
import { connectPathFor } from "@/features/connect/pending-authorization";
import { routing, type Locale } from "@/i18n/routing";

const isLocale = (value: string | undefined): value is Locale => routing.locales.includes(value as Locale);
const LOCALE_COOKIE = (typeof routing.localeCookie === "object" && routing.localeCookie.name) || "NEXT_LOCALE";

/**
 * The locale for a page reached without one in its address, the way next-intl picks it:
 * the saved language cookie first, then the browser's preferred languages, then English.
 */
function localeOf(request: NextRequest): Locale {
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  const preferred = (request.headers.get("accept-language") ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { language: tag.split("-")[0].toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(({ language, quality }) => language !== "" && quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .find(({ language }) => isLocale(language));
  return preferred ? (preferred.language as Locale) : routing.defaultLocale;
}

/**
 * Supabase Auth's OAuth server sends the person here (its `authorization_url_path`) when an
 * assistant app asks for access. This route sits outside [locale] and the proxy, so it only
 * picks the language and forwards to the consent page. Only a well-formed authorization id
 * is carried along; anything else lands on the page's "link no longer works" state.
 */
export function GET(request: NextRequest) {
  const origin = siteBase(process.env.NEXT_PUBLIC_SITE_URL, request.nextUrl.origin);
  const path = connectPathFor(request.nextUrl.searchParams.get("authorization_id")) ?? "/connect";
  return NextResponse.redirect(new URL(`/${localeOf(request)}${path}`, origin), {
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    },
  });
}
