import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

export const supabaseConfigured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

/** Keep token cookies and cache protection when composing a locale/auth response. */
export function copySessionResponse(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value !== null) target.headers.set(header, value);
  }
  return target;
}

/**
 * Refreshes the session cookie on `response` and returns the signed-in
 * user's email (or null).
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<{ email: string | null }> {
  // Auth redirects depend on the visitor even when their JWT needs no refresh.
  // Never let a shared cache reuse that decision for another visitor.
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) => {
            if (options.maxAge === 0) request.cookies.delete(name);
            else request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        },
      },
    },
  );

  // getClaims refreshes an expired session and verifies the JWT locally.
  const { data } = await supabase.auth.getClaims();
  const claimEmail = data?.claims.email;
  const email = typeof claimEmail === "string" ? claimEmail.toLowerCase() : null;
  return { email };
}
