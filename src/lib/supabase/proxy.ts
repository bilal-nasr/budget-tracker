import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

export const supabaseConfigured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

/**
 * Refreshes the session cookie on `response` and returns the signed-in
 * user's email (or null).
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<{ email: string | null }> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
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
