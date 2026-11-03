import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

export const supabaseConfigured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

/**
 * Refreshes the session cookie on `response` and returns the signed-in
 * owner's email (or null). Any session whose email is not OWNER_EMAIL is
 * signed out.
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

  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase() ?? null;
  const owner = process.env.OWNER_EMAIL?.toLowerCase();

  if (email && (!owner || email !== owner)) {
    await supabase.auth.signOut();
    return { email: null };
  }
  return { email };
}
