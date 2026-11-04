import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { copySessionResponse, refreshSession, supabaseConfigured } from "./lib/supabase/proxy";

const intl = createIntlMiddleware(routing);

// Pages a signed-out visitor may open. A signed-in one is sent into the app instead.
const PUBLIC = /^\/(en|ar)\/(sign-in|sign-up|check-email|forgot-password)\/?$/;

export async function proxy(request: NextRequest) {
  // Without Supabase configured (fresh checkout), skip auth so the shell loads.
  if (!supabaseConfigured()) return intl(request);

  const sessionResponse = NextResponse.next();
  const { email } = await refreshSession(request, sessionResponse);
  // next-intl snapshots request headers. Refresh first so the downstream render
  // sees the rotated cookies and does not try to refresh the old token again.
  const response = intl(request);
  const finish = (target: NextResponse) => copySessionResponse(sessionResponse, target);

  // Locale redirects/rewrites from next-intl win first, retaining auth cookies.
  if (response.headers.get("location")) return finish(response);
  const { pathname } = request.nextUrl;

  if (!email && !PUBLIC.test(pathname)) {
    const locale = pathname.split("/")[1];
    const target = routing.locales.includes(locale as never)
      ? locale
      : routing.defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${target}/sign-in`;
    const targetResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => targetResponse.cookies.set(cookie));
    return finish(targetResponse);
  }
  if (email && PUBLIC.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/\/(sign-in|sign-up|check-email|forgot-password)\/?$/, "");
    const targetResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => targetResponse.cookies.set(cookie));
    return finish(targetResponse);
  }
  return finish(response);
}

export const config = {
  // Explicit locale matcher. (A negative-lookahead matcher silently skipped /en/* here.)
  matcher: ["/", "/(en|ar)/:path*"],
};
