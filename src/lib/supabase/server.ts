import { createServerClient } from "@supabase/ssr";
import { createClient as createBearerClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connectorContext } from "./request-context";

/**
 * Server Components / Server Actions client. Uses the user's session + RLS.
 * Inside a connector request it acts as the person behind the bearer token
 * instead, and never reads or writes cookies.
 */
export async function createClient(headers?: Record<string, string>) {
  const connector = connectorContext();
  if (connector) {
    // A caller header, in any letter case, can never replace or join the connector's token.
    const extra = Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization"));
    return createBearerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { ...extra, Authorization: `Bearer ${connector.accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      },
    );
  }
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(headers ? { global: { headers } } : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component; the proxy refreshes the session.
          }
        },
      },
    },
  );
}
