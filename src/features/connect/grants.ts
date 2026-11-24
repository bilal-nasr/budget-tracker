import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { mcpUrl } from "@/lib/mcp/public-url";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { connectorContext } from "@/lib/supabase/request-context";
import { createClient } from "@/lib/supabase/server";
import { clientName } from "./redirect";

/** An assistant app the signed-in person approved. `name` is plain text (never HTML). */
export type ConnectedApp = { clientId: string; name: string; grantedAt: string | null };

/**
 * The shape of an OAuth client id. Supabase's are UUIDs; it goes into a Supabase Auth query
 * string when revoking, so anything beyond URL-safe characters is refused.
 */
export const connectedAppIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const grantedAt = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;

/**
 * The apps the signed-in person approved, from Supabase Auth's own grant list (the browser
 * session's, so only ever this person's). Null when it could not be loaded; [] when none.
 * A grant whose client id could not be revoked is left out.
 */
export async function getConnectedApps(): Promise<ConnectedApp[] | null> {
  // A connected app's own token never lists grants; only the person's browser session does.
  if (!supabaseConfigured() || connectorContext()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.oauth.listGrants();
    if (error || !Array.isArray(data)) return null;
    const apps: ConnectedApp[] = [];
    for (const grant of data as unknown[]) {
      const client = (grant as { client?: { id?: unknown; name?: unknown } } | null)?.client;
      const id = connectedAppIdSchema.safeParse(client?.id);
      if (!id.success) continue;
      apps.push({ clientId: id.data, name: clientName(client?.name), grantedAt: grantedAt((grant as { granted_at?: unknown }).granted_at) });
    }
    return apps;
  } catch {
    return null;
  }
}

// A Host header is client-supplied: only a hostname or [IPv6] literal with an optional port.
const HOST = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/;
const FALLBACK_ORIGIN = "http://localhost:3000";

/**
 * This request's own origin, the Server Component equivalent of `new URL(request.url).origin`
 * in the consent and discovery routes. `mcpUrl` uses it only when NEXT_PUBLIC_SITE_URL is unset.
 */
async function requestOrigin(): Promise<string> {
  try {
    const list = await headers();
    const host = list.get("x-forwarded-host")?.split(",")[0]?.trim() || list.get("host") || "";
    const proto = list.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (!HOST.test(host)) return FALLBACK_ORIGIN;
    return `${proto === "https" ? "https" : "http"}://${host}`;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

/**
 * What the "Connect Claude" help needs: the connector address to paste, and the apps the owner
 * registered (`connector_clients`, oldest first). The address is still given when the list
 * cannot be read.
 */
export async function getConnectorSetup(): Promise<{ url: string; clients: { clientId: string; name: string }[] }> {
  const url = mcpUrl(await requestOrigin());
  if (!supabaseConfigured()) return { url, clients: [] };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("connector_clients").select("client_id, name").order("created_at", { ascending: true });
    if (error || !Array.isArray(data)) return { url, clients: [] };
    const clients = (data as { client_id?: unknown; name?: unknown }[]).flatMap((row) =>
      typeof row?.client_id === "string" && row.client_id !== "" ? [{ clientId: row.client_id, name: clientName(row.name) }] : [],
    );
    return { url, clients };
  } catch {
    return { url, clients: [] };
  }
}
