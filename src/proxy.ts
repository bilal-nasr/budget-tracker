import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { rememberAuthorization } from "./features/connect/pending-authorization";
import { rememberJoin } from "./features/invoices/pending-join";
import { routing } from "./i18n/routing";
import { copySessionResponse, refreshSession, supabaseConfigured } from "./lib/supabase/proxy";

const intl = createIntlMiddleware(routing);

// Pages a signed-out visitor may open. A signed-in one is sent into the app instead.
const PUBLIC = /^\/(en|ar)\/(sign-in|sign-up|check-email|forgot-password)\/?$/;
// Export requests must reach their route so an expired session receives a
// machine-readable 401 instead of a followed sign-in redirect and HTML file.
const AUTHENTICATED_API = /^\/(en|ar)\/settings\/export\/?$/;
// A share link. A signed-out visitor's link is remembered so they come back to it after signing in.
const JOIN_LINK = /^\/(en|ar)\/invoices\/join\/([0-9a-f]{64})\/?$/;
// The consent screen for an assistant app asking to connect. Not public: a signed-out visitor's
// authorization id is remembered so they come back to it after signing in.
const CONNECT = /^\/(en|ar)\/connect\/?$/;

/**
 * Whether the visitor reached the app over HTTPS. The app is self-hosted behind a TLS-terminating
 * reverse proxy, so the request it sees is plain HTTP: the proxy's `x-forwarded-proto` says what the
 * browser used, and without it a production build is assumed to be served over HTTPS.
 */
function viaHttps(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production";
}

export async function proxy(request: NextRequest) {
  // Without Supabase configured (fresh checkout), skip auth so the shell loads.
  if (!supabaseConfigured()) return intl(request);

  const sessionResponse = NextResponse.next();
  const { email } = await refreshSession(request, sessionResponse);
  // next-intl snapshots request headers. Refresh first so the downstream render
  // sees the rotated cookies and does not try to refresh the old token again.
  const response = intl(request);
  const finish = (target: NextResponse) => {
    // The share link's token and the authorization id are in the address, so nothing opened
    // from those pages (including the app the approval is sent to) may be told where it came from.
    const { pathname } = request.nextUrl;
    if (JOIN_LINK.test(pathname) || CONNECT.test(pathname)) target.headers.set("Referrer-Policy", "no-referrer");
    // The consent screen must never be framed by another site, or Allow could be clickjacked.
    if (CONNECT.test(pathname)) {
      target.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
      target.headers.set("X-Frame-Options", "DENY");
    }
    return copySessionResponse(sessionResponse, target);
  };

  // Locale redirects/rewrites from next-intl win first, retaining auth cookies.
  if (response.headers.get("location")) return finish(response);
  const { pathname } = request.nextUrl;

  if (!email && !PUBLIC.test(pathname) && !AUTHENTICATED_API.test(pathname)) {
    const locale = pathname.split("/")[1];
    const target = routing.locales.includes(locale as never)
      ? locale
      : routing.defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${target}/sign-in`;
    const join = JOIN_LINK.exec(pathname);
    const connect = CONNECT.test(pathname);
    // The authorization id is remembered in a cookie; it has no business in the sign-in address.
    if (connect) url.search = "";
    const targetResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => targetResponse.cookies.set(cookie));
    const secure = viaHttps(request);
    const remembered = join
      ? rememberJoin(join[2], { secure })
      : connect
        ? rememberAuthorization(request.nextUrl.searchParams.get("authorization_id") ?? "", { secure })
        : null;
    if (remembered) targetResponse.cookies.set(remembered);
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
