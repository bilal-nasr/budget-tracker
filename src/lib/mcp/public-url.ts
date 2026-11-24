import type { OAuthMetadata } from "@modelcontextprotocol/server";
import { z } from "zod";
import { siteBase } from "@/features/auth/redirect";

const trimSlashes = (value: string) => value.trim().replace(/\/+$/, "");

/**
 * The connector endpoint's public address: the configured site (not the request's
 * own origin, which is internal behind a proxy) plus the optional base path.
 */
export function mcpUrl(requestOrigin: string): string {
  const basePath = trimSlashes(process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  return `${siteBase(process.env.NEXT_PUBLIC_SITE_URL, requestOrigin)}${basePath}/mcp`;
}

const supabaseBase = () => trimSlashes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

/** Supabase Auth acts as the OAuth authorization server; this is its issuer. */
export function authServerIssuer(): string {
  return `${supabaseBase()}/auth/v1`;
}

// The local stack serves the document under /auth/v1; hosted projects document the
// RFC 8414 path-inserted form. Both are tried, local first.
const metadataUrls = (base: string) => [
  `${base}/auth/v1/.well-known/oauth-authorization-server`,
  `${base}/.well-known/oauth-authorization-server/auth/v1`,
];

const metadataShape = z.looseObject({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  response_types_supported: z.array(z.string()),
});

const ONE_HOUR_MS = 60 * 60 * 1000;
// A slow sign-in service must not hold a discovery request open indefinitely.
const FETCH_TIMEOUT_MS = 5000;
const cache = new Map<string, { metadata: OAuthMetadata; until: number }>();

/**
 * The authorization server's RFC 8414 metadata, or null when neither address answers
 * with a usable document. A success is held in memory for an hour; a failure is not,
 * so the next request tries again.
 */
export async function fetchAuthServerMetadata(): Promise<OAuthMetadata | null> {
  const base = supabaseBase();
  if (!base) return null;
  const hit = cache.get(base);
  if (hit && hit.until > Date.now()) return hit.metadata;

  for (const url of metadataUrls(base)) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const parsed = metadataShape.safeParse(await response.json());
      if (!parsed.success) continue;
      const metadata = parsed.data as OAuthMetadata;
      cache.set(base, { metadata, until: Date.now() + ONE_HOUR_MS });
      return metadata;
    } catch {
      // Unreachable, timed out or not JSON; try the next address.
    }
  }
  return null;
}
