import "server-only";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";
import { getUserEmail } from "@/lib/supabase/user";
import { authorizationIdSchema } from "./pending-authorization";
import { clientName, redirectHost, usableRedirect } from "./redirect";

export type AuthorizationRequest =
  | { kind: "expired" }
  | { kind: "redirect"; url: string }
  | { kind: "consent"; id: string; name: string; host: string; email: string | null };

/**
 * What Supabase Auth says about an authorization, for the consent page. Anything unusable is
 * "expired", never a blank screen. A malformed id never reaches Supabase (it goes into a URL path).
 */
export async function lookUpAuthorization(raw: unknown): Promise<AuthorizationRequest> {
  const id = authorizationIdSchema.safeParse(raw);
  if (!id.success || !supabaseConfigured()) return { kind: "expired" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id.data);
    if (error || !data) return { kind: "expired" };
    if (!("authorization_id" in data)) {
      // Already allowed earlier: Supabase hands back the app's address with a fresh code.
      const url = usableRedirect(data.redirect_url);
      return url ? { kind: "redirect", url } : { kind: "expired" };
    }
    const host = redirectHost(data.redirect_uri);
    if (!host) return { kind: "expired" };
    const email = (await getUserEmail()) ?? (typeof data.user?.email === "string" ? data.user.email : null);
    return { kind: "consent", id: id.data, name: clientName(data.client?.name), host, email };
  } catch {
    return { kind: "expired" };
  }
}
