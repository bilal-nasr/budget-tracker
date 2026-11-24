import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  requireBearerAuth,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import packageJson from "../../../package.json";
import { authInfoUserId, bearerVerifier } from "@/lib/mcp/auth";
import { mcpUrl } from "@/lib/mcp/public-url";
import { allTools } from "@/lib/mcp/registry";
import { TOOL_FAILED_TEXT, ToolError, toolAnnotations, toResult, type ToolDef } from "@/lib/mcp/tool";
import { runAsConnector } from "@/lib/supabase/request-context";
import { supabaseConfigured } from "@/lib/supabase/proxy";

/**
 * The MCP connector endpoint (stateless Streamable HTTP). It sits outside [locale], so the
 * proxy's cookie session logic never runs here; every request must carry a bearer token,
 * and a missing or invalid one is a 401 that points at the discovery metadata.
 */
export const dynamic = "force-dynamic";

const failed = (): CallToolResult => ({ isError: true, content: [{ type: "text", text: TOOL_FAILED_TEXT }] });

function registerTool(server: McpServer, def: ToolDef) {
  const config = { title: def.title, description: def.description, annotations: toolAnnotations(def.kind) };
  const execute = async (args: Record<string, unknown>, ctx: ServerContext): Promise<CallToolResult> => {
    // authInfo is what the gate below verified; the SDK never derives it from request headers.
    const authInfo = ctx.http?.authInfo;
    const userId = authInfoUserId(authInfo);
    if (!authInfo || !userId) return failed();
    try {
      return toResult(await runAsConnector({ accessToken: authInfo.token, userId }, () => def.run(args)));
    } catch (error) {
      if (error instanceof ToolError) return { isError: true, content: [{ type: "text", text: error.message }] };
      console.error(`[mcp] ${def.name} failed`, error);
      return failed();
    }
  };
  if (def.input) server.registerTool(def.name, { ...config, inputSchema: def.input }, (args, ctx) => execute(args, ctx));
  else server.registerTool(def.name, config, (ctx) => execute({}, ctx));
}

// One handler for the process; it builds a fresh server per request from this factory.
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "budget-tracker", version: packageJson.version });
  for (const def of allTools) registerTool(server, def);
  return server;
});

async function handle(request: Request): Promise<Response> {
  if (!supabaseConfigured()) {
    return Response.json(
      { error: "temporarily_unavailable", error_description: "The budget service is not configured." },
      { status: 503 },
    );
  }
  const resource = new URL(mcpUrl(new URL(request.url).origin));
  const gate = requireBearerAuth({
    verifier: bearerVerifier,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
  });
  const auth = await gate(request);
  if (auth instanceof Response) return auth;
  return handler.fetch(request, { authInfo: auth });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}
