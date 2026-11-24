"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/supabase/user";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { connectorContext } from "@/lib/supabase/request-context";
import { connectedAppIdSchema } from "./grants";
import { usableRedirect } from "./redirect";
import { authorizationIdSchema, forgetPendingAuthorization } from "./pending-authorization";

export type DecideAuthorizationResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: "invalid" | "expired" | "failed" };

const decisionSchema = z.object({
  authorizationId: authorizationIdSchema,
  decision: z.enum(["approve", "deny"]),
});

/**
 * The person's answer on the consent screen. Supabase Auth records it for the signed-in
 * account and returns the address to send the browser to (the app's own redirect URI
 * with a code, or with `access_denied`). That address is the only place the browser is
 * ever sent; nothing from the page's own address is used.
 */
export async function decideAuthorization(
  authorizationId: string,
  decision: "approve" | "deny",
): Promise<DecideAuthorizationResult> {
  const parsed = decisionSchema.safeParse({ authorizationId, decision });
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!supabaseConfigured()) return { ok: false, error: "failed" };
  try {
    if (!(await getUserId())) return { ok: false, error: "failed" };
    const supabase = await createClient();
    const { authorizationId: id } = parsed.data;
    const options = { skipBrowserRedirect: true };
    const { data, error } = parsed.data.decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(id, options)
      : await supabase.auth.oauth.denyAuthorization(id, options);
    if (error) return { ok: false, error: "expired" };
    const redirectUrl = usableRedirect(data?.redirect_url);
    if (!redirectUrl) return { ok: false, error: "failed" };
    // Decided: a remembered copy must not bring the person back here after their next sign-in.
    await forgetPendingAuthorization().catch(() => {});
    return { ok: true, redirectUrl };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export type RevokeConnectedAppResult = { ok: true } | { ok: false; error: "invalid" | "failed" };

/**
 * Supabase Auth's answer when the person has no grant for that app (already removed, say in
 * another tab): 404 `oauth_consent_not_found`, measured against the local stack. Matched on
 * status and code only, never on message text; the result is what Remove wanted, so it is ok.
 */
const alreadyRemoved = (error: { status?: unknown; code?: unknown }) =>
  error.status === 404 && error.code === "oauth_consent_not_found";

/**
 * Removes the signed-in person's approval of one app. Supabase Auth's grant API acts on the
 * session's own user only (DELETE /user/oauth/grants?client_id=…), so no other account's grant
 * can be touched; it also ends that app's sessions and refresh tokens. Its earlier access tokens
 * (JWTs, still validly signed) are then refused by the database guard at once, because their
 * session is gone, and by `/mcp` within 60 s, since its approved-app cache is kept per app and
 * session, so other people's use of the same app does not keep it open (scripts/test-mcp.mjs group (f)).
 */
export async function revokeConnectedApp(clientId: string): Promise<RevokeConnectedAppResult> {
  const parsed = connectedAppIdSchema.safeParse(clientId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  // A connector request never reaches a Server Action, but a connected app must never remove grants.
  if (!supabaseConfigured() || connectorContext()) return { ok: false, error: "failed" };
  try {
    if (!(await getUserId())) return { ok: false, error: "failed" };
    const supabase = await createClient();
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId: parsed.data });
    if (error && !alreadyRemoved(error)) return { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
  revalidatePath("/[locale]/settings", "page");
  return { ok: true };
}
