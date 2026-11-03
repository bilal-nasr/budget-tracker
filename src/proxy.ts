import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { refreshSession, supabaseConfigured } from "./lib/supabase/proxy";

const intl = createIntlMiddleware(routing);

const SIGN_IN = /^\/(en|ar)\/sign-in\/?$/;

export async function proxy(request: NextRequest) {
  const response = intl(request);

  // Locale redirects/rewrites from next-intl win first.
  if (response.headers.get("location")) return response;

  // Without Supabase configured (fresh checkout), skip auth so the shell loads.
  if (!supabaseConfigured()) return response;

  const { email } = await refreshSession(request, response);
  const { pathname } = request.nextUrl;

  if (!email && !SIGN_IN.test(pathname)) {
    const locale = pathname.split("/")[1];
    const target = routing.locales.includes(locale as never)
      ? locale
      : routing.defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${target}/sign-in`;
    return NextResponse.redirect(url);
  }
  if (email && SIGN_IN.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/\/sign-in\/?$/, "");
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Explicit locale matcher. (A negative-lookahead matcher silently skipped /en/* here.)
  matcher: ["/", "/(en|ar)/:path*"],
};
