import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { refreshSession, supabaseConfigured } from "./lib/supabase/proxy";

const intl = createIntlMiddleware(routing);

// Pages a signed-out visitor may open. A signed-in one is sent into the app instead.
const PUBLIC = /^\/(en|ar)\/(sign-in|sign-up|check-email)\/?$/;

export async function proxy(request: NextRequest) {
  const response = intl(request);

  // Locale redirects/rewrites from next-intl win first.
  if (response.headers.get("location")) return response;

  // Without Supabase configured (fresh checkout), skip auth so the shell loads.
  if (!supabaseConfigured()) return response;

  const { email } = await refreshSession(request, response);
  const { pathname } = request.nextUrl;

  if (!email && !PUBLIC.test(pathname)) {
    const locale = pathname.split("/")[1];
    const target = routing.locales.includes(locale as never)
      ? locale
      : routing.defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${target}/sign-in`;
    return NextResponse.redirect(url);
  }
  if (email && PUBLIC.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/\/(sign-in|sign-up|check-email)\/?$/, "");
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Explicit locale matcher. (A negative-lookahead matcher silently skipped /en/* here.)
  matcher: ["/", "/(en|ar)/:path*"],
};
