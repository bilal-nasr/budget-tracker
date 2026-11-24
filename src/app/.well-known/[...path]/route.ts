import { getOAuthProtectedResourceMetadataUrl, oauthMetadataResponse } from "@modelcontextprotocol/server";
import { fetchAuthServerMetadata, mcpUrl } from "@/lib/mcp/public-url";

/**
 * OAuth discovery for the connector: RFC 9728 protected-resource metadata for `/mcp`
 * (naming Supabase Auth as the authorization server) and the authorization server's
 * RFC 8414 metadata, passed through. Every other well-known path is a 404.
 */
export const dynamic = "force-dynamic";

const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";
const stripTrailingSlash = (path: string) => (path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path);
const CORS = { "Access-Control-Allow-Origin": "*" };

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Context) {
  const { path } = await params;
  const resourceServerUrl = new URL(mcpUrl(new URL(request.url).origin));
  // Match against the public address, so how a base path shows up in request.url does not matter.
  const canonical = new Request(new URL(`/.well-known/${path.map(encodeURIComponent).join("/")}`, resourceServerUrl), {
    method: request.method,
    headers: request.headers,
  });
  // Only the two documents oauthMetadataResponse serves are worth a metadata fetch; the same
  // paths it matches: the path-aware protected-resource address of /mcp, and the server's own.
  const requested = stripTrailingSlash(new URL(canonical.url).pathname);
  const served = [new URL(getOAuthProtectedResourceMetadataUrl(resourceServerUrl)).pathname, AUTHORIZATION_SERVER_PATH];
  if (!served.includes(requested)) return new Response(null, { status: 404 });

  const oauthMetadata = await fetchAuthServerMetadata();
  if (!oauthMetadata) {
    return Response.json(
      { error: "temporarily_unavailable", error_description: "The sign-in service did not answer." },
      { status: 503, headers: { ...CORS, "Retry-After": "30" } },
    );
  }

  try {
    // http issuers are accepted only for localhost/127.0.0.1 (the SDK's own rule); no insecure override is set.
    return oauthMetadataResponse(canonical, { oauthMetadata, resourceServerUrl }) ?? new Response(null, { status: 404 });
  } catch {
    // The SDK rejected the issuer (http outside localhost, or a query/fragment).
    return Response.json(
      { error: "temporarily_unavailable", error_description: "The sign-in service is misconfigured." },
      { status: 503, headers: CORS },
    );
  }
}

export function OPTIONS(request: Request) {
  const requested = request.headers.get("access-control-request-headers");
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      ...(requested ? { "Access-Control-Allow-Headers": requested, Vary: "Access-Control-Request-Headers" } : {}),
    },
  });
}
