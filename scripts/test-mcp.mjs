// End-to-end check of the /mcp connector endpoint with real Supabase tokens: auth gate,
// discovery, the 55 tools (17 read, 38 write), account isolation between two fresh users, and the
// approved-apps-only hardening with a real OAuth-issued token (no browser): /mcp and the
// database API accept a registered app's token for reads and for the listed writes only, removing
// the app shuts it out, self-registration is off, all 17 read tools work with that token (through
// the guard), and the write tools change A's data with it: retry keys never post twice, balances
// come back, B's account is untouched and B cannot change A's rows.
// What the app's token can do to the account through Supabase Auth is measured: whether it can
// change the password, and whether it can approve a new authorization request for its own app
// (self-approval, which would give it a fresh session). Either one FAILS the run unless
// MCP_ACCEPT_PASSWORD_RESIDUAL=1 is set (a test flag only, for when the owner has accepted that
// residual; the result is printed either way).
// After a person's own revokeGrant, the app's earlier access token must be refused by the
// database API at once and by /mcp within 60 s; what the Auth API, the refresh token and a
// repeated revokeGrant do is printed as MEASURED facts. After the person signs out of the
// browser (signOut(), global scope, as the app's Sign out does), what the app's token, its
// refresh token and listGrants do is printed as MEASURED facts. Reading auth.* (sessions, and what the
// cleanup leaves) uses `docker exec` on the local database container (auth.* is not exposed
// through the database API).
//
// LOCAL ONLY. It reads the API URL and keys from `pnpm exec supabase status` (never from
// .env.local, which may point at a hosted project), refuses any Supabase host other than
// 127.0.0.1/localhost, creates four throwaway confirmed users (A and B, plus P for the
// self-approval group and C for the sign-out group) and one throwaway OAuth app (recorded in
// connector_clients) with the secret key, and deletes all of it (the users' data by cascade) at
// the end. The self-approval group moves one of P's app sessions back 25 h in the local database
// (`docker exec`), to see the password window close. It never prints keys or tokens.
//
// It does not start the app. Start it against the LOCAL stack first; process env wins over
// .env.local, so these overrides are what the server sees (Git Bash, from the repo root).
// MCP_ALLOW_SESSION_TOKENS=1 lets the password-session groups use /mcp (local testing only):
//
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(pnpm exec supabase status -o env 2>/dev/null | grep '^PUBLISHABLE_KEY=' | cut -d= -f2- | tr -d '"')" \
//   NEXT_PUBLIC_SITE_URL=http://localhost:3100 NEXT_PUBLIC_BASE_PATH= MCP_ALLOW_SESSION_TOKENS=1 \
//   pnpm exec next dev --port 3100
//
// then:  MCP_TEST_APP_URL=http://localhost:3100 pnpm test:mcp
// (MCP_TEST_APP_URL defaults to http://localhost:3000.) Exit code 0 means every group passed.
// While an app token can change the password or approve itself, groups (e) and (e2) fail. To
// run green after the owner has accepted that residual:  MCP_ACCEPT_PASSWORD_RESIDUAL=1 pnpm test:mcp
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { claimsOf, codeFromRedirect, exchangeCode, headlessAppTokens, refreshAppTokens, startAuthorization } from "./lib/connector-oauth.mjs";

const READ_TOOLS = [
  "profile_get", "currencies_list", "wallets_list", "categories_list", "transactions_list", "summary_get",
  "budgets_get", "fixed_expenses_list", "installments_list", "salary_status_get", "loans_list", "loans_history",
  "pending_payments_list", "pending_payments_receipts", "shopping_items_list", "invoices_folders_list",
  "invoices_folder_get",
];
// Deletes, voids and balance adjustments: the client is told to ask first (destructiveHint).
const DESTRUCTIVE_TOOLS = [
  "wallets_delete", "wallets_adjust_balance", "transactions_delete", "categories_delete", "budgets_delete",
  "fixed_expenses_delete", "installments_delete", "loans_delete", "loans_delete_payment", "pending_payments_delete",
  "shopping_items_delete", "invoices_folders_delete",
];
const WRITE_TOOLS = [
  "wallets_create", "wallets_update", "transactions_create", "transactions_update", "transactions_restore",
  "categories_create", "categories_update", "categories_restore", "budgets_set", "fixed_expenses_create",
  "fixed_expenses_update", "installments_create", "installments_update", "loans_create", "loans_update",
  "loans_record_payment", "pending_payments_create", "pending_payments_update", "pending_payments_record_receipt",
  "salary_update", "salary_mark_received", "profile_update", "shopping_items_create", "shopping_items_update",
  "invoices_folders_create", "invoices_folders_update",
];
const EXPECTED_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS];
const NO_INPUT_TOOLS = [
  "profile_get", "currencies_list", "wallets_list", "categories_list", "summary_get", "fixed_expenses_list",
  "installments_list", "salary_status_get", "loans_list", "pending_payments_list", "shopping_items_list",
  "invoices_folders_list",
];
const FOLDER_NOT_FOUND = "Folder not found.";
// The throwaway app's redirect address. Nothing listens there: the code is read from the
// approval's redirect_url, as a browser would be sent to it.
const APP_REDIRECT = "http://localhost:8976/callback";
// How long /mcp may keep trusting a removed app (its positive cache, src/lib/mcp/clients.ts), plus slack.
const REMOVAL_GRACE_MS = 70_000;

// ---------------------------------------------------------------- local stack only

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function localStack() {
  const run = spawnSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (run.status !== 0) fail("`pnpm exec supabase status` failed; start the local stack with `pnpm db:start`.");
  const out = run.stdout ?? "";
  let status;
  try {
    status = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  } catch {
    fail("Could not read `supabase status -o json` output.");
  }
  const apiUrl = String(status.API_URL ?? "").replace(/\/+$/, "");
  const publishable = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secret = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  let host = "";
  try {
    host = new URL(apiUrl).hostname;
  } catch {
    fail("supabase status gave no usable API_URL.");
  }
  // This script creates and deletes users with the secret key: never against anything but this machine.
  if (host !== "127.0.0.1" && host !== "localhost") fail(`Refusing to run: Supabase API host is "${host}", not 127.0.0.1/localhost.`);
  if (!publishable || !secret) fail("supabase status gave no publishable/secret key.");
  return { apiUrl, publishable, secret };
}

const { apiUrl, publishable, secret } = localStack();
const appUrl = (process.env.MCP_TEST_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const mcpEndpoint = `${appUrl}/mcp`;
const admin = createClient(apiUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------- helpers

let groups = 0;
function ok(label) {
  groups += 1;
  console.log(`ok ${groups} - ${label}`);
}
let failed = 0;
/** One assertion group. A failing group is reported and the run goes on to the next one. */
async function group(fn) {
  try {
    await fn();
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
}
/** Runs every sub-check of a group before judging, so one run names every failure. */
function collector() {
  const failing = [];
  const passing = [];
  return {
    async attempt(label, run) {
      try {
        await run();
        passing.push(label);
      } catch (error) {
        failing.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    finish(label) {
      check(failing.length === 0, `${failing.length} sub-check(s) failed:\n     ${failing.join("\n     ")}\n     (passed: ${passing.join(", ") || "none"})`);
      ok(label);
    },
  };
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}
// Only fixed, non-secret facts go into messages; bodies are cut short and tokens never appear.
const short = (value) => {
  const text = typeof value === "string" ? value : String(JSON.stringify(value));
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};

const users = [];
async function makeUser(label) {
  const email = `mcp-test-${label}-${randomBytes(6).toString("hex")}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser ${label}: ${created.error?.message}`);
  users.push(created.data.user.id);
  // `auth` keeps this password session in memory, to approve OAuth requests as this person.
  const auth = createClient(apiUrl, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(`signIn ${label}: ${signed.error?.message}`);
  return { label, id: created.data.user.id, email, password, auth, session: signed.data.session, token: signed.data.session.access_token };
}

/** Whether email + password signs in right now (a fresh client each time; nothing kept). */
async function signsIn(email, password) {
  const probe = createClient(apiUrl, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  return !error && Boolean(data.session);
}

/**
 * Tries to set a new random password for `user` with `token` (PUT /auth/v1/user, no nonce, no
 * current password), then signs in with the old and the new one to see which works. Prints one
 * MEASURED line; keeps `user.password` current. Returns `{ outcome, changed }`.
 */
async function tryPasswordChange(user, token, what) {
  const newPassword = randomBytes(18).toString("base64url");
  const response = await fetch(`${apiUrl}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: publishable, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ password: newPassword }),
  });
  const outcome = await authOutcome(response);
  const oldWorks = await signsIn(user.email, user.password);
  const newWorks = await signsIn(user.email, newPassword);
  console.log(`     MEASURED PUT /auth/v1/user {password} with ${what} → ${outcome}; old password signs in: ${oldWorks}; new password signs in: ${newWorks}`);
  check(oldWorks !== newWorks, `inconclusive password check with ${what}: old password signs in ${oldWorks}, new ${newWorks}`);
  if (newWorks) user.password = newPassword;
  return { outcome: `${outcome}, password ${newWorks ? "CHANGED" : "unchanged"}`, changed: newWorks };
}

/**
 * A real OAuth-issued access token for `user` and app `clientId`, without a browser: start an
 * authorization request with PKCE (S256), approve it as the user (the consent screen's own
 * calls), and exchange the returned code at the token endpoint (scripts/lib/connector-oauth.mjs).
 * Only statuses and error codes ever reach a message.
 */
async function oauthToken(user, clientId) {
  return (await oauthTokens(user, clientId)).accessToken;
}

/** As `oauthToken`, but both tokens from the code exchange: `{ accessToken, refreshToken }`. */
function oauthTokens(user, clientId) {
  return headlessAppTokens({ apiUrl, publishable, approver: user.auth, clientId, redirectUri: APP_REDIRECT, expectedUserId: user.id, label: user.label });
}

const ACCEPT_PASSWORD_RESIDUAL = process.env.MCP_ACCEPT_PASSWORD_RESIDUAL === "1";

/** A database API (PostgREST) request with `token`; returns status and parsed body (never printed whole). */
async function rest(token, method, path, body) {
  const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: publishable, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=minimal" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}
const forbidden = (result) => result.status === 403 && result.json?.code === "42501" && result.json?.message === "connector.forbidden";
/** An Auth API error body as `status error_code "msg"`; a success body (the user) is never shown. */
async function authOutcome(response) {
  const json = await response.json().catch(() => ({}));
  if (response.ok) return `${response.status}`;
  return `${response.status} ${json.error_code ?? json.code ?? ""} "${short(json.msg ?? json.message ?? "")}"`;
}

/** A supabase-js client acting as the user (RLS applies), optionally with extra headers. */
function asUser(user, headers = {}) {
  return createClient(apiUrl, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${user.token}`, ...headers } },
  });
}

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-mcp", version: "0.0.0" } },
});
function rawPost(headers = {}) {
  return fetch(mcpEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: initializeBody,
  });
}

async function connect(user) {
  const client = new Client({ name: "test-mcp", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint), {
    requestInit: { headers: { Authorization: `Bearer ${user.token}` } },
  });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const result = await client.callTool(args === undefined ? { name } : { name, arguments: args });
  return result;
}
const textOf = (result) => (result.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");
function data(result, name) {
  check(!result.isError, `${name} returned isError: ${short(textOf(result))}`);
  return result.structuredContent ?? JSON.parse(textOf(result));
}

/**
 * Calls each of the 17 read tools once through `client`: every no-input tool, transactions_list {},
 * budgets_get for a listed currency, and the id tools with unknown ids (empty pages /
 * "Folder not found."). Returns the collector's `finish` and the currency used, so the caller
 * names the group.
 */
async function allTools(client) {
  const { attempt, finish } = collector();
  const called = new Set();
  const tool = async (name, args) => {
    called.add(name);
    return call(client, name, args);
  };
  for (const name of NO_INPUT_TOOLS) await attempt(name, async () => data(await tool(name), name));
  let currencyCode = "USD";
  await attempt("currencies_list (code)", async () => {
    const currencies = data(await tool("currencies_list"), "currencies_list");
    const list = Array.isArray(currencies) ? currencies : (currencies.items ?? currencies.currencies ?? []);
    currencyCode = list.find((c) => c.code === "USD")?.code ?? list[0]?.code;
    check(typeof currencyCode === "string", `currencies_list gave no currency code: ${short(currencies)}`);
  });
  await attempt("transactions_list {}", async () => data(await tool("transactions_list", {}), "transactions_list"));
  await attempt("budgets_get", async () => data(await tool("budgets_get", { currency: currencyCode }), "budgets_get"));
  await attempt("loans_history", async () => {
    const history = data(await tool("loans_history", { loanId: randomUUID() }), "loans_history");
    check(Array.isArray(history.rows) && history.rows.length === 0, `unknown id not empty: ${short(history)}`);
  });
  await attempt("pending_payments_receipts", async () => {
    const receipts = data(await tool("pending_payments_receipts", { paymentId: randomUUID() }), "pending_payments_receipts");
    check(Array.isArray(receipts.receipts) && receipts.receipts.length === 0, `unknown id not empty: ${short(receipts)}`);
  });
  await attempt("invoices_folder_get", async () => {
    const missing = await tool("invoices_folder_get", { folderId: randomUUID() });
    check(missing.isError === true && textOf(missing) === FOLDER_NOT_FOUND, `unknown id: ${short(missing)}`);
  });
  await attempt("every tool called", async () => {
    const missing = READ_TOOLS.filter((name) => !called.has(name));
    check(missing.length === 0, `not called: ${short(missing)}`);
  });
  return { currencyCode, finish };
}

/**
 * The Supabase project the APP under test uses, read from its own discovery document (the
 * authorization server it names). Fails the run unless that is this local stack: every check
 * below, and the cookie name in group 4 especially, is only meaningful against it.
 */
async function appSupabaseUrl() {
  const localIssuer = `${apiUrl}/auth/v1`;
  let response;
  try {
    response = await rawPost();
  } catch (error) {
    fail(`Could not reach the app at ${appUrl} (${error instanceof Error ? error.message : String(error)}). Start it first (see the header of this script).`);
  }
  const match = /resource_metadata="([^"]+)"/.exec(response.headers.get("www-authenticate") ?? "");
  if (response.status !== 401 || !match) fail(`POST ${mcpEndpoint} without a token gave ${response.status} with no resource_metadata; is ${appUrl} this app?`);
  let servers;
  try {
    const metadata = await (await fetch(match[1], { headers: { accept: "application/json" } })).json();
    servers = Array.isArray(metadata.authorization_servers) ? metadata.authorization_servers.map((s) => String(s).replace(/\/+$/, "")) : [];
  } catch {
    fail(`Could not read the app's discovery document at ${match[1]}.`);
  }
  if (!servers.includes(localIssuer)) {
    fail(`The app at ${appUrl} is not pointed at the local stack: its authorization server is ${short(servers)}, not ${localIssuer}. ` +
      "Start it with the NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY overrides in this script's header.");
  }
  return localIssuer.slice(0, -"/auth/v1".length);
}

/**
 * The cookie(s) @supabase/ssr would set for this session in the app: sb-<ref>-auth-token
 * (ref = first label of the app's Supabase host), base64url JSON, chunked.
 */
function ssrSessionCookie(session, supabaseUrl) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const name = `sb-${ref}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const CHUNK = 3180;
  if (value.length <= CHUNK) return `${name}=${value}`;
  const parts = [];
  for (let i = 0; i * CHUNK < value.length; i += 1) parts.push(`${name}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  return parts.join("; ");
}

/** Change one character in the middle of the signature segment (never the padding-sensitive last one). */
function tamper(token) {
  const parts = token.split(".");
  check(parts.length === 3 && parts[2].length > 4, "access token is not a JWT");
  const sig = parts[2];
  const at = Math.floor(sig.length / 2);
  const swapped = sig[at] === "A" ? "B" : "A";
  parts[2] = `${sig.slice(0, at)}${swapped}${sig.slice(at + 1)}`;
  const tampered = parts.join(".");
  check(tampered !== token, "tampering changed nothing");
  return tampered;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * One `select` on the local database as postgres, its single-line answer trimmed, or null when it
 * cannot be run. auth.* is not exposed through the database API even to the secret key, so this
 * asks the local database container directly (`docker exec … psql`, the stack's own container for
 * this repo's supabase/config.toml project_id). Callers put only UUID-checked ids into `sql`.
 */
function localSql(sql) {
  let config = "";
  try {
    config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  } catch {
    return null;
  }
  const projectId = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(config)?.[1];
  if (!projectId) return null;
  const run = spawnSync("docker", ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" });
  return run.status === 0 ? (run.stdout ?? "").trim() : null;
}

/**
 * Whether auth.sessions still holds the session `sessionId` of user `userId`: true / false, or
 * null when it cannot be told. The user must exist in that database, so a different one cannot answer.
 */
function sessionRowExists(sessionId, userId) {
  if (!UUID.test(String(sessionId)) || !UUID.test(String(userId))) return null;
  const answer = /^(\d+):(\d+)$/.exec(localSql(
    `select (select count(*) from auth.users where id = '${userId}') || ':' || (select count(*) from auth.sessions where id = '${sessionId}' and user_id = '${userId}')`,
  ) ?? "");
  if (!answer || answer[1] !== "1") return null;
  return answer[2] !== "0";
}

/**
 * Rows Supabase Auth keeps for the test users or the test app (sessions, consents, authorization
 * requests), as "sessions:consents:authorizations", or null when it cannot be told.
 */
function authRowsLeft(userIds, clientId) {
  const ids = userIds.filter((id) => UUID.test(String(id)));
  if (ids.length !== userIds.length || (clientId && !UUID.test(String(clientId)))) return null;
  const users = ids.length ? ids.map((id) => `'${id}'`).join(",") : "null";
  const client = clientId ? `'${clientId}'` : "null";
  const answer = localSql(
    `select (select count(*) from auth.sessions where user_id in (${users}) or oauth_client_id = ${client}) || ':' ||` +
    ` (select count(*) from auth.oauth_consents where user_id in (${users}) or client_id = ${client}) || ':' ||` +
    ` (select count(*) from auth.oauth_authorizations where user_id in (${users}) or client_id = ${client})`,
  );
  return answer && /^\d+:\d+:\d+$/.test(answer) ? answer : null;
}

// ---------------------------------------------------------------- the run

const clients = [];
let appClientId = null;
try {
  console.log(`# Supabase ${apiUrl} (local), app ${appUrl}`);
  // Before any user is created: the app must be using this same local stack.
  const appSupabase = await appSupabaseUrl();
  console.log(`# the app's discovery names ${appSupabase}/auth/v1, the local stack`);

  // 1. Two fresh confirmed users, each with a real password session.
  const a = await makeUser("a");
  const b = await makeUser("b");
  ok("created two confirmed users with the admin API and signed each in with a password");

  // 2. No token: 401 that points at discovery, and discovery names the local Supabase Auth.
  await group(async () => {
    const response = await rawPost();
    check(response.status === 401, `no-token POST /mcp: expected 401, got ${response.status} ${short(await response.text())}`);
    const header = response.headers.get("www-authenticate") ?? "";
    const match = /resource_metadata="([^"]+)"/.exec(header);
    check(header.startsWith("Bearer") && match, `no-token 401 has no usable WWW-Authenticate: ${short(header)}`);
    const metaResponse = await fetch(match[1], { headers: { accept: "application/json" } });
    check(metaResponse.ok, `GET ${match[1]}: ${metaResponse.status}`);
    const meta = await metaResponse.json();
    const issuer = `${apiUrl}/auth/v1`;
    check(Array.isArray(meta.authorization_servers) && meta.authorization_servers.some((s) => s.replace(/\/+$/, "") === issuer),
      `authorization_servers ${short(meta.authorization_servers)} does not contain ${issuer} (is the app pointed at the local stack?)`);
    check(meta.resource === mcpEndpoint, `resource is ${short(meta.resource)}, expected ${mcpEndpoint} (NEXT_PUBLIC_SITE_URL should be the app address)`);
    ok("POST /mcp without a token is 401; its WWW-Authenticate metadata lists the local …/auth/v1 as authorization server");
  });

  // 3. A real password-session token is accepted; the same token with one signature character changed is not.
  await group(async () => {
    const good = await rawPost({ authorization: `Bearer ${a.token}` });
    const goodBody = await good.text();
    check(good.status === 200, `valid session token: expected 200, got ${good.status} ${short(goodBody)}` +
      (good.status === 401 ? " (start the app with MCP_ALLOW_SESSION_TOKENS=1; see this script's header)" : ""));
    check(goodBody.includes("\"serverInfo\""), `valid session token: initialize result has no serverInfo: ${short(goodBody)}`);
    const bad = await rawPost({ authorization: `Bearer ${tamper(a.token)}` });
    check(bad.status === 401, `tampered token: expected 401, got ${bad.status} ${short(await bad.text())}`);
    check((bad.headers.get("www-authenticate") ?? "").includes("invalid_token"), "tampered token: WWW-Authenticate lacks invalid_token");
    ok("a real local password-session access token is accepted (200 initialize); a tampered signature is 401 invalid_token");
  });

  // 4. A valid browser session cookie is not a credential for /mcp. The cookie is first shown to
  // be one the app accepts (a signed-in page is not sent to sign-in), so the 401 is not vacuous.
  await group(async () => {
    const cookie = ssrSessionCookie(a.session, appSupabase);
    const page = await fetch(`${appUrl}/en/wallets`, { headers: { cookie }, redirect: "manual" });
    const location = page.headers.get("location") ?? "";
    const landed = location ? new URL(location, appUrl).pathname : "";
    check(!/\/sign-in\/?$/.test(landed),
      `the app does not accept the forged session cookie (GET /en/wallets → ${page.status} ${short(location)}), so a 401 from /mcp would prove nothing`);
    const response = await rawPost({ cookie });
    check(response.status === 401, `cookie-only request: expected 401, got ${response.status} ${short(await response.text())}`);
    ok(`A's @supabase/ssr session cookie (${cookie.split("=")[0]}) signs A in on a browser page (GET /en/wallets → ${page.status}${landed ? ` ${landed}` : ""}), yet the same cookie with no Authorization header is 401 at /mcp`);
  });

  // 5. Exactly the 55 tools, each with the hints of its kind.
  const clientA = await connect(a);
  clients.push(clientA);
  const clientB = await connect(b);
  clients.push(clientB);
  await group(async () => {
    const tools = [];
    let cursor;
    do {
      const page = await clientA.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const names = tools.map((tool) => tool.name).sort();
    check(JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
      `tool list mismatch. extra: ${short(names.filter((n) => !EXPECTED_TOOLS.includes(n)))} missing: ${short(EXPECTED_TOOLS.filter((n) => !names.includes(n)))}`);
    const wrong = tools.filter((tool) => {
      const hints = tool.annotations ?? {};
      if (READ_TOOLS.includes(tool.name)) return hints.readOnlyHint !== true;
      return hints.readOnlyHint !== false || hints.destructiveHint !== DESTRUCTIVE_TOOLS.includes(tool.name);
    }).map((tool) => tool.name);
    check(wrong.length === 0, `tools with the wrong hints: ${short(wrong)}`);
    const loose = tools.filter((tool) => !READ_TOOLS.includes(tool.name) && tool.inputSchema?.additionalProperties !== false).map((tool) => tool.name);
    check(loose.length === 0, `write tools whose input schema allows unknown keys: ${short(loose)}`);
    ok(`listTools as A (bearer via requestInit.headers) returns exactly the ${EXPECTED_TOOLS.length} expected tools: ${READ_TOOLS.length} readOnlyHint true, ${WRITE_TOOLS.length} writes (destructiveHint false), ${DESTRUCTIVE_TOOLS.length} destructiveHint true; every write tool's input schema refuses unknown keys`);
  });

  // 6. Every tool works for a fresh account (password session; group (a2) repeats it with the app's token).
  await group(async () => {
    const { currencyCode, finish } = await allTools(clientA);
    finish(`all 17 read tools answer for fresh account A: ${NO_INPUT_TOOLS.length} no-input tools + transactions_list {} + budgets_get {currency: ${currencyCode}} without isError; id tools with unknown ids give empty pages / "${FOLDER_NOT_FOUND}"`);
  });

  // 7. A wallet and an expense for A (through the app's own RPCs, as A); A sees it with amount.text, B sees nothing.
  // B's empty list counts only when A's list (same tool, same code path) shows the expense: an empty page
  // alone proves nothing (a database error is now an isError result, but an empty page could still hide a bug).
  await group(async () => {
    const units = { "x-budget-units": JSON.stringify({ USD: 2 }) };
    const dbA = asUser(a, units);
    const walletName = `MCP test wallet ${randomBytes(3).toString("hex")}`;
    const created = await dbA.rpc("create_wallet", { p_name: walletName, p_kind: "cash", p_default_currency: "USD", p_opening_minor: 0 });
    check(!created.error && typeof created.data === "string", `create_wallet as A: ${short(created.error)}`);
    const walletId = created.data;
    const wallet = await dbA.from("wallets").select("default_balance_id").eq("id", walletId).single();
    check(!wallet.error && wallet.data?.default_balance_id, `read A's new wallet: ${short(wallet.error)}`);
    const category = await dbA.from("categories").select("id").eq("kind", "expense").is("parent_id", null).order("position").limit(1).single();
    check(!category.error && category.data?.id, `read A's expense category: ${short(category.error)}`);
    const expenseId = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const saved = await dbA.rpc("save_transaction", {
      p_id: expenseId,
      p_expected_revision: null,
      p_input: { kind: "expense", occurredOn: today, balanceId: wallet.data.default_balance_id, amountMinor: 1234, categoryId: category.data.id, note: "MCP test expense" },
      p_items: null,
      p_settlement: null,
    });
    check(!saved.error && Array.isArray(saved.data) && saved.data[0]?.id === expenseId, `save_transaction as A: ${short(saved.error ?? saved.data)}`);
    console.log("     (A's wallet and USD 12.34 expense saved through create_wallet + save_transaction as A)");

    const { attempt, finish } = collector();
    let text = "";
    let aSeesExpense = false;
    await attempt("transactions_list (A)", async () => {
      const pageA = data(await call(clientA, "transactions_list", {}), "transactions_list (A)");
      const row = pageA.rows.find((r) => r.id === expenseId);
      check(row, `A's list does not contain the new expense: ${short(pageA)}`);
      check(row.amount?.minor === 1234 && row.amount?.currency === "USD" && typeof row.amount?.text === "string" && row.amount.text.length > 0,
        `A's expense amount is not formatted: ${short(row.amount)}`);
      text = row.amount.text;
      aSeesExpense = true;
    });
    let balanceText = "";
    await attempt("wallets_list (A)", async () => {
      const walletsA = data(await call(clientA, "wallets_list"), "wallets_list (A)");
      const found = (walletsA.wallets ?? []).find((w) => w.id === walletId);
      check(found, "A's wallets_list does not contain A's new wallet");
      const balance = (found.balances ?? []).find((b) => b.id === wallet.data.default_balance_id);
      check(balance, `A's new wallet has no default USD balance in wallets_list: ${short(found)}`);
      // Opening 0, one USD 12.34 expense: the balance is -1234 cents, with display text.
      check(balance.amount?.minor === -1234 && balance.amount?.currency === "USD" && typeof balance.amount?.text === "string" && balance.amount.text.includes("12.34"),
        `A's balance is not -1234 USD with formatted text: ${short(balance.amount)}`);
      balanceText = balance.amount.text;
    });
    await attempt("transactions_list (B)", async () => {
      const pageB = data(await call(clientB, "transactions_list", {}), "transactions_list (B)");
      check(Array.isArray(pageB.rows) && pageB.rows.length === 0, `B's list is not empty: ${short(pageB)}`);
      check(aSeesExpense, "B's list is empty, but A's is not proven to work, so B's empty page proves nothing");
    });
    await attempt("wallets_list (B)", async () => {
      const walletsB = JSON.stringify(data(await call(clientB, "wallets_list"), "wallets_list (B)"));
      check(!walletsB.includes(walletId) && !walletsB.includes(walletName), "B's wallets_list shows A's wallet");
    });
    finish(`A's expense is listed for A with amount.text "${text}"; A's wallet balance is listed as "${balanceText}"; B gets 0 transactions and does not see A's wallet`);
  });

  // 8. An invoice folder of A's: listed for A, invisible to B, and B's direct get is a bare "Folder not found.".
  await group(async () => {
    const dbA = asUser(a);
    const folderId = randomUUID();
    const folderName = `MCP test folder ${randomBytes(3).toString("hex")}`;
    const inserted = await dbA.from("invoice_folders").insert({ id: folderId, name: folderName }).select("id");
    check(!inserted.error && inserted.data?.length === 1, `insert A's invoice folder: ${short(inserted.error)}`);
    const seenByB = await asUser(b).from("invoice_folders").select("id").eq("id", folderId);
    check(!seenByB.error && seenByB.data?.length === 0, `B can read A's folder row directly: ${short(seenByB.error ?? seenByB.data)}`);
    console.log("     (A's folder inserted as A; the row is readable by A and not by B through PostgREST)");

    const { attempt, finish } = collector();
    await attempt("invoices_folders_list (A)", async () => {
      const foldersA = data(await call(clientA, "invoices_folders_list"), "invoices_folders_list (A)");
      check(foldersA.folders.some((f) => f.id === folderId), "A's invoices_folders_list does not contain A's folder");
    });
    await attempt("invoices_folder_get (A)", async () => {
      const getA = data(await call(clientA, "invoices_folder_get", { folderId }), "invoices_folder_get (A)");
      check(JSON.stringify(getA).includes(folderName), "A's invoices_folder_get does not return the folder");
    });
    await attempt("invoices_folders_list (B)", async () => {
      const foldersB = JSON.stringify(data(await call(clientB, "invoices_folders_list"), "invoices_folders_list (B)"));
      check(!foldersB.includes(folderId) && !foldersB.includes(folderName), "B's invoices_folders_list shows A's folder");
    });
    await attempt("invoices_folder_get (B, A's id)", async () => {
      const getB = await call(clientB, "invoices_folder_get", { folderId });
      check(getB.isError === true, `not an error: ${short(getB)}`);
      check(getB.content?.length === 1 && getB.content[0].type === "text" && getB.content[0].text === FOLDER_NOT_FOUND,
        `result is not exactly one text block "${FOLDER_NOT_FOUND}": ${short(getB)}`);
      check(getB.structuredContent === undefined, `carries structuredContent: ${short(getB.structuredContent)}`);
      const whole = JSON.stringify(getB);
      check(!whole.includes(folderName) && !whole.includes(a.id), "mentions A's folder name or A's id");
    });
    finish(`A's invoice folder is listed/readable for A; B does not see it and B's invoices_folder_get gets isError with exactly "${FOLDER_NOT_FOUND}" and nothing else`);
  });

  // ------------------------------------------------------------ approved apps only

  // A throwaway public (PKCE) app, registered as the owner would, and a real OAuth token for A.
  const registered = await admin.auth.admin.oauth.createClient({
    client_name: `mcp-test-app-${randomBytes(4).toString("hex")}`,
    redirect_uris: [APP_REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  check(!registered.error && registered.data?.client_id, `admin createClient: ${short(registered.error?.message)}`);
  appClientId = registered.data.client_id;
  check(registered.data.client_type === "public" && !registered.data.client_secret, "the test app is not a public client without a secret");
  const listed = await admin.from("connector_clients").insert({ client_id: appClientId, name: registered.data.client_name });
  check(!listed.error, `insert into connector_clients: ${short(listed.error?.message)}`);
  const appToken = await oauthToken(a, appClientId);
  ok("registered a throwaway public PKCE app (admin API, localhost redirect), recorded it in connector_clients, and got a real OAuth token for A (authorize → approveAuthorization → code exchange); the token carries the app's client_id");
  const appA = { label: "a (app)", token: appToken };

  // (a) /mcp accepts the registered app's token: the 55 tools, and a read works through the database guard.
  await group(async () => {
    const appClient = await connect(appA);
    clients.push(appClient);
    const { tools } = await appClient.listTools();
    const names = tools.map((tool) => tool.name).sort();
    check(JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()), `the app sees a different tool list: ${short(names)}`);
    const wallets = data(await call(appClient, "wallets_list"), "wallets_list (app token)");
    check((wallets.wallets ?? []).length >= 1, `wallets_list with the app token does not show A's wallet: ${short(wallets)}`);
    const folder = data(await call(appClient, "invoices_folders_list"), "invoices_folders_list (app token)");
    check(Array.isArray(folder.folders), "invoices_folders_list with the app token gave no folders array");
    ok(`(a) /mcp accepts A's OAuth token for the registered app: listTools gives the ${EXPECTED_TOOLS.length} tools, and wallets_list (${wallets.wallets.length} wallet) reads through the database guard`);
  });

  // (a2) Every tool works with the app's token, so each one's reads pass the database guard (the
  // password-session run in group 6 never meets the guard). A now has a wallet, an expense and an
  // invoice folder, so the reads are not all empty.
  await group(async () => {
    const appClient = await connect(appA);
    clients.push(appClient);
    const { currencyCode, finish } = await allTools(appClient);
    finish(`(a2) all 17 read tools answer with A's OAuth app token (through the database guard): ${NO_INPUT_TOOLS.length} no-input tools + transactions_list {} + budgets_get {currency: ${currencyCode}} without isError; id tools with unknown ids give empty pages / "${FOLDER_NOT_FOUND}"`);
  });

  // (w) The write tools, with A's OAuth app token (so every write passes the database guard).
  // Money is followed on one USD balance in integer cents: `expected` is what the balance must be
  // after each step, read back through wallets_list. Retry keys are sent twice. B (a password
  // session) must neither see nor change any of it.
  await group(async () => {
    const appClient = await connect(appA);
    clients.push(appClient);
    const { attempt, finish } = collector();
    const run = async (name, args) => data(await call(appClient, name, args), name);
    const refused = async (client, name, args) => {
      try {
        const result = await call(client, name, args);
        return result.isError === true ? textOf(result) : null;
      } catch (error) {
        return `protocol error: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    const dbA = asUser(a);
    const today = new Date().toISOString().slice(0, 10);
    const tag = randomBytes(3).toString("hex");
    const cat = async (kind) => {
      const row = await dbA.from("categories").select("id").eq("kind", kind).is("parent_id", null).is("archived_at", null).order("position").limit(1).single();
      check(!row.error && row.data?.id, `read A's ${kind} category: ${short(row.error)}`);
      return row.data.id;
    };
    const expenseCategory = await cat("expense");
    const incomeCategory = await cat("income");
    let walletId, balanceId, otherBalanceId, txId, txRevision;
    let expected = 0;
    const balanceNow = async () => {
      const wallets = await run("wallets_list");
      const found = wallets.wallets.flatMap((w) => w.balances).find((b) => b.id === balanceId);
      check(found, "the test balance is not in wallets_list");
      return found.balanceMinor;
    };
    const balanceIs = async (label) => {
      const now = await balanceNow();
      check(now === expected, `${label}: balance is ${now}, expected ${expected}`);
    };
    const inResult = (result, label) => {
      const found = (result.balances ?? []).flatMap((w) => w.balances).find((b) => b.id === balanceId);
      check(found && found.balanceMinor === expected && found.amount?.minor === expected && found.amount?.currency === "USD",
        `${label}: the result's balances do not show ${expected} USD cents for the balance: ${short(found)}`);
    };

    await attempt("wallets_create (requestId sent twice)", async () => {
      const requestId = randomUUID();
      const args = { requestId, name: `MCP write ${tag}`, kind: "cash", currency: "USD", openingBalanceMinor: 10000 };
      const first = await run("wallets_create", args);
      const second = await run("wallets_create", args);
      check(first.wallet?.id && second.wallet?.id === first.wallet.id && second.replayed === true && first.replayed === undefined,
        `a repeat did not replay the first wallet: ${short({ first: first.wallet?.id, second: second.wallet?.id, replayed: second.replayed })}`);
      const made = await admin.from("wallets").select("id", { count: "exact", head: true }).eq("user_id", a.id).eq("name", args.name);
      check(made.count === 1, `expected exactly one wallet named for this run, found ${made.count}`);
      walletId = first.wallet.id;
      balanceId = first.wallet.balances.find((b) => b.currency === "USD")?.id;
      check(balanceId, "the new wallet has no USD balance");
      expected = 10000;
      await balanceIs("after wallets_create");
      const other = await run("wallets_create", { name: `MCP other ${tag}`, kind: "bank", currency: "USD" });
      otherBalanceId = other.wallet.balances.find((b) => b.currency === "USD")?.id;
      const renamed = await run("wallets_update", { walletId, name: `MCP renamed ${tag}`, kind: "card", position: 0 });
      check(renamed.wallet.name === `MCP renamed ${tag}` && renamed.wallet.kind === "card", `wallets_update did not return the new name and kind: ${short(renamed.wallet)}`);
      const order = (await run("wallets_list")).wallets.map((w) => w.id);
      check(order[0] === walletId, "wallets_update position 0 did not move the wallet first");
    });

    await attempt("transactions_create expense (requestId sent twice), update, delete, restore", async () => {
      const requestId = randomUUID();
      const args = { requestId, kind: "expense", balanceId, amountMinor: 2500, categoryId: expenseCategory, occurredOn: today, note: `mcp write ${tag}` };
      const first = await run("transactions_create", args);
      const second = await run("transactions_create", args);
      check(first.transaction?.id && second.transaction?.id === first.transaction.id, "a repeated transactions_create did not return the first transaction");
      const made = await admin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", a.id).eq("note", args.note);
      check(made.count === 1, `expected exactly one transaction for the repeated request, found ${made.count}`);
      check(first.transaction.amount?.minor === 2500 && first.transaction.amount?.currency === "USD", `the created transaction's amount: ${short(first.transaction.amount)}`);
      expected -= 2500;
      inResult(first, "transactions_create");
      await balanceIs("after transactions_create");
      txId = first.transaction.id;
      const updated = await run("transactions_update", { id: txId, revision: first.transaction.revision, amountMinor: 3000 });
      check(updated.transaction.amountMinor === 3000 && updated.transaction.note === args.note && updated.transaction.revision > first.transaction.revision,
        `transactions_update result: ${short(updated.transaction)}`);
      expected -= 500;
      inResult(updated, "transactions_update");
      const stale = await refused(appClient, "transactions_update", { id: txId, revision: first.transaction.revision, amountMinor: 1 });
      check(stale && /changed since it was read/.test(stale), `an old revision was not refused as a conflict: ${short(stale)}`);
      const removed = await run("transactions_delete", { id: txId, revision: updated.transaction.revision });
      check(removed.deleted === true && removed.id === txId && Number.isInteger(removed.revision), `transactions_delete result: ${short(removed)}`);
      expected += 3000;
      inResult(removed, "transactions_delete");
      const restored = await run("transactions_restore", { id: txId, revision: removed.revision });
      expected -= 3000;
      inResult(restored, "transactions_restore");
      txRevision = restored.transaction.revision;
      await balanceIs("after delete and restore");
    });

    await attempt("transactions_create transfer and income", async () => {
      const moved = await run("transactions_create", { requestId: randomUUID(), kind: "transfer", sourceBalanceId: balanceId, destinationBalanceId: otherBalanceId, sentMinor: 1000, occurredOn: today });
      expected -= 1000;
      inResult(moved, "transfer");
      const arrived = moved.balances.flatMap((w) => w.balances).find((b) => b.id === otherBalanceId);
      check(arrived?.balanceMinor === 1000, `the destination balance is ${arrived?.balanceMinor}, expected 1000`);
      const income = await run("transactions_create", { requestId: randomUUID(), kind: "income", balanceId, amountMinor: 700, categoryId: incomeCategory, occurredOn: today });
      expected += 700;
      inResult(income, "income");
    });

    await attempt("wallets_adjust_balance (up, then again: nothing to do)", async () => {
      const before = expected;
      const set = await run("wallets_adjust_balance", { targets: [{ balanceId, targetMinor: 12345 }], occurredOn: today });
      const one = set.results?.[0];
      check(one && one.previousMinor === before && one.targetMinor === 12345 && one.matched === true && typeof one.transactionId === "string",
        `wallets_adjust_balance result: ${short(one)}`);
      expected = 12345;
      inResult(set, "wallets_adjust_balance");
      await balanceIs("after wallets_adjust_balance");
      const again = await run("wallets_adjust_balance", { targets: [{ balanceId, targetMinor: 12345 }] });
      check(again.results[0].transactionId === null && again.results[0].matched === true, `a repeated adjust posted again: ${short(again.results[0])}`);
      const down = await run("wallets_adjust_balance", { targets: [{ balanceId, targetMinor: 12000 }], occurredOn: today });
      check(down.results[0].matched === true, "adjusting down did not match");
      expected = 12000;
      const corrections = await dbA.from("categories").select("kind").eq("name_en", "Balance correction");
      check(!corrections.error && corrections.data.length === 2, `expected one "Balance correction" category per kind, found ${corrections.data?.length}`);
      await balanceIs("after adjusting down");
    });

    await attempt("categories and budgets", async () => {
      const requestId = randomUUID();
      const args = { requestId, kind: "expense", nameEn: `MCP cat ${tag}`, tile: 3, color: "teal" };
      const created = await run("categories_create", args);
      const repeat = await run("categories_create", args);
      check(created.category?.id && repeat.category?.id === created.category.id && repeat.replayed === true, "a repeated categories_create did not replay");
      const categoryId = created.category.id;
      const renamed = await run("categories_update", { id: categoryId, nameEn: `MCP cat2 ${tag}` });
      check(JSON.stringify(renamed.category).includes(`MCP cat2 ${tag}`), "categories_update did not return the new name");
      const month = today.slice(0, 7);
      const budget = await run("budgets_set", { month, currency: "USD", limits: [{ categoryId, limitMinor: 5000 }] });
      check(JSON.stringify(budget).includes(categoryId) && JSON.stringify(budget).includes("5000"), `budgets_set does not return the new limit: ${short(budget)}`);
      const cleared = await run("budgets_delete", { month, currency: "USD", categoryId });
      check(cleared.deleted === true, "budgets_delete did not report deleted");
      const removed = await run("categories_delete", { id: categoryId });
      check(removed.deleted === true && ["deleted", "archived"].includes(removed.outcome), `categories_delete result: ${short(removed)}`);
    });

    await attempt("fixed expenses and installments", async () => {
      const fixed = await run("fixed_expenses_create", { requestId: randomUUID(), name: `MCP rent ${tag}`, amountMinor: 40000, balanceId, categoryId: expenseCategory, dueDay: 5 });
      check(fixed.expense?.id, `fixed_expenses_create did not return the new expense: ${short(fixed)}`);
      const changed = await run("fixed_expenses_update", { id: fixed.expense.id, amountMinor: 45000 });
      check(JSON.stringify(changed.expense).includes("45000"), "fixed_expenses_update did not return the new amount");
      check((await run("fixed_expenses_delete", { id: fixed.expense.id })).deleted === true, "fixed_expenses_delete");
      const plan = await run("installments_create", { requestId: randomUUID(), name: `MCP phone ${tag}`, totalMinor: 60000, balanceId, categoryId: expenseCategory, monthlyMinor: 5000 });
      check(plan.installment?.id, `installments_create did not return the new installment: ${short(plan)}`);
      const edited = await run("installments_update", { id: plan.installment.id, name: `MCP phone2 ${tag}` });
      check(JSON.stringify(edited.installment).includes(`MCP phone2 ${tag}`), "installments_update did not return the new name");
      check((await run("installments_delete", { id: plan.installment.id })).deleted === true, "installments_delete");
      await balanceIs("templates move no money");
    });

    await attempt("loans and pending payments", async () => {
      const lent = await run("loans_create", { requestId: randomUUID(), name: `MCP loan ${tag}`, direction: "borrowed", principalMinor: 20000, feeBps: 0, balanceId, feeCategoryId: expenseCategory, openedOn: today });
      check(lent.loan?.id, `loans_create did not return the loan: ${short(lent)}`);
      expected += 20000;
      inResult(lent, "loans_create");
      const paid = await run("loans_record_payment", { requestId: randomUUID(), loanId: lent.loan.id, balanceId, amountMinor: 5000, occurredOn: today });
      expected -= 5000;
      inResult(paid, "loans_record_payment");
      check(paid.payment?.transactionId && Number.isInteger(paid.payment?.revision), `loans_record_payment did not return the payment's id and revision: ${short(paid.payment)}`);
      const voided = await run("loans_delete_payment", { loanId: lent.loan.id, transactionId: paid.payment.transactionId, revision: paid.payment.revision });
      expected += 5000;
      inResult(voided, "loans_delete_payment");
      const renamedLoan = await run("loans_update", { id: lent.loan.id, name: `MCP loan2 ${tag}` });
      check(renamedLoan.loan.name === `MCP loan2 ${tag}`, "loans_update did not return the new name");
      const job = await run("pending_payments_create", { requestId: randomUUID(), client: `MCP client ${tag}`, project: "Site", currency: "USD", totalMinor: 30000 });
      check(job.payment?.id && Number.isInteger(job.payment?.revision), `pending_payments_create result: ${short(job)}`);
      const edited = await run("pending_payments_update", { id: job.payment.id, revision: job.payment.revision, project: "Site v2" });
      check(edited.payment.project === "Site v2", "pending_payments_update did not return the new project");
      const receipt = await run("pending_payments_record_receipt", { requestId: randomUUID(), paymentId: job.payment.id, balanceId, categoryId: incomeCategory, amountMinor: 12000, occurredOn: today });
      expected += 12000;
      inResult(receipt, "pending_payments_record_receipt");
      const spare = await run("pending_payments_create", { requestId: randomUUID(), client: `MCP spare ${tag}`, project: "None", currency: "USD", totalMinor: 100 });
      check((await run("pending_payments_delete", { id: spare.payment.id, revision: spare.payment.revision })).deleted === true, "pending_payments_delete");
      await balanceIs("after loans and pending payments");
    });

    await attempt("salary and profile", async () => {
      const saved = await run("salary_update", { amountMinor: 150000, balanceId });
      check(JSON.stringify(saved).includes("150000") && JSON.stringify(saved).includes(balanceId), `salary_update did not return the saved salary: ${short(saved)}`);
      const status = await run("salary_status_get");
      const requestId = randomUUID();
      const args = { requestId, expectedReceiptId: status.receiptId ?? null };
      const got = await run("salary_mark_received", args);
      const repeat = await run("salary_mark_received", args);
      check(got.receipt?.id && repeat.receipt?.id === got.receipt.id, "a repeated salary_mark_received did not return the first receipt");
      expected += 150000;
      inResult(got, "salary_mark_received");
      await balanceIs("salary received once for a repeated request");
      const profile = await run("profile_update", { theme: "dark", salaryEmail: false });
      check(profile.theme === "dark", `profile_update did not return the new theme: ${short(profile)}`);
      check((await run("profile_get")).theme === "dark", "profile_get does not show the new theme");
    });

    await attempt("shopping items and invoice folders (requestId is the row id)", async () => {
      const itemId = randomUUID();
      const itemArgs = { requestId: itemId, name: `MCP milk ${tag}`, currency: "USD", priceMinor: 250, quantity: 2 };
      await run("shopping_items_create", itemArgs);
      await run("shopping_items_create", itemArgs);
      const items = (await run("shopping_items_list")).items.filter((item) => item.name === itemArgs.name);
      check(items.length === 1 && items[0].id === itemId, `expected one shopping item with the request's id, found ${items.length}`);
      const edited = await run("shopping_items_update", { itemId, quantity: 3 });
      check(JSON.stringify(edited).includes(itemId), "shopping_items_update did not return the item");
      check((await run("shopping_items_delete", { itemId })).deleted === true, "shopping_items_delete");
      const folderId = randomUUID();
      const folderArgs = { requestId: folderId, name: `MCP build ${tag}` };
      await run("invoices_folders_create", folderArgs);
      await run("invoices_folders_create", folderArgs);
      const folders = (await run("invoices_folders_list")).folders.filter((folder) => folder.id === folderId);
      check(folders.length === 1, `expected one folder with the request's id, found ${folders.length}`);
      const renamed = await run("invoices_folders_update", { folderId, name: `MCP build2 ${tag}` });
      check(JSON.stringify(renamed).includes(`MCP build2 ${tag}`), "invoices_folders_update did not return the new name");
      check((await run("invoices_folders_delete", { folderId })).deleted === true, "invoices_folders_delete");
      const gone = await refused(appClient, "invoices_folder_get", { folderId });
      check(gone === FOLDER_NOT_FOUND, `the deleted folder is still readable: ${short(gone)}`);
    });

    await attempt("strict inputs and wallets_delete", async () => {
      const extra = await refused(appClient, "transactions_create", { kind: "expense", balanceId, amountMinor: 100, categoryId: expenseCategory, user_id: b.id });
      check(extra, "an unknown input key was accepted");
      const float = await refused(appClient, "transactions_create", { kind: "expense", balanceId, amountMinor: 1.5, categoryId: expenseCategory });
      check(float, "a non-integer amount was accepted");
      const nonzero = await refused(appClient, "wallets_delete", { walletId });
      check(nonzero && /zero/.test(nonzero), `deleting a wallet with money in it was not refused: ${short(nonzero)}`);
      await balanceIs("after refused calls");
    });

    await attempt("B neither sees nor changes A's rows", async () => {
      const walletsB = JSON.stringify(data(await call(clientB, "wallets_list"), "wallets_list (B)"));
      check(!walletsB.includes(walletId) && !walletsB.includes(tag), "B's wallets_list shows A's wallet");
      const rowsB = data(await call(clientB, "transactions_list", {}), "transactions_list (B)");
      check(rowsB.rows.length === 0, `B has ${rowsB.rows.length} transactions after A's writes`);
      for (const [name, args] of [
        ["transactions_update", { id: txId, revision: txRevision, amountMinor: 1 }],
        ["transactions_delete", { id: txId, revision: txRevision }],
        ["wallets_update", { walletId, name: "Taken" }],
        ["wallets_delete", { walletId }],
        ["wallets_adjust_balance", { targets: [{ balanceId, targetMinor: 0 }] }],
        ["transactions_create", { kind: "expense", balanceId, amountMinor: 100, categoryId: expenseCategory, occurredOn: today }],
      ]) {
        const answer = await refused(clientB, name, args);
        check(answer, `B's ${name} on A's row was not refused`);
        check(!answer.includes(tag) && !answer.includes(a.id), `B's ${name} refusal mentions A's data: ${short(answer)}`);
      }
      await balanceIs("after B's attempts");
      const still = await admin.from("wallets").select("name, deleted_at").eq("id", walletId).single();
      check(still.data?.name === `MCP renamed ${tag}` && still.data?.deleted_at === null, "A's wallet changed after B's attempts");
    });

    await attempt("the app token on the database API: a listed write is allowed", async () => {
      const result = await fetch(`${apiUrl}/rest/v1/rpc/create_wallet`, {
        method: "POST",
        headers: { apikey: publishable, authorization: `Bearer ${appToken}`, "content-type": "application/json" },
        body: JSON.stringify({ p_name: `MCP direct ${tag}`, p_kind: "cash", p_default_currency: "USD", p_opening_minor: 0 }),
      });
      await result.body?.cancel();
      check(result.status === 200, `POST /rest/v1/rpc/create_wallet with the app token: ${result.status}`);
    });

    finish(`(w) write tools with A's OAuth app token through /mcp and the database guard: wallets, transactions (expense, income, transfer; update, delete, restore), balance adjustment, categories, budgets, fixed expenses, installments, loans and payments, pending payments and receipts, salary, profile, shopping items and invoice folders all change A's data and return it; repeated requestIds posted once; the USD balance followed to ${expected} cents; strict inputs; B sees none of it and every attempt by B on A's rows is refused`);
  });

  // (b) The same token on the database API directly: reads yes; writes that no tool makes are refused, nothing written.
  await group(async () => {
    const { attempt, finish } = collector();
    const count = async (table) => {
      const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", a.id);
      check(!result.error, `count ${table}: ${short(result.error?.message)}`);
      return result.count;
    };
    const before = { transactions: await count("transactions"), wallets: await count("wallets") };
    let balanceId = null;
    await attempt("GET /rest/v1/wallets", async () => {
      const result = await rest(appToken, "GET", "wallets?select=id,default_balance_id");
      check(result.status === 200 && Array.isArray(result.json) && result.json.length === before.wallets && before.wallets >= 1,
        `expected 200 with A's ${before.wallets} wallet(s), got ${result.status} (${Array.isArray(result.json) ? `${result.json.length} rows` : short(result.json?.message)})`);
      balanceId = result.json[0].default_balance_id;
    });
    const category = await asUser(a).from("categories").select("id").eq("kind", "expense").is("parent_id", null).limit(1).single();
    const today = new Date().toISOString().slice(0, 10);
    await attempt("POST /rest/v1/transactions", async () => {
      const result = await rest(appToken, "POST", "transactions", {
        id: randomUUID(), user_id: a.id, kind: "expense", occurred_on: today, balance_id: balanceId, amount_minor: 99, category_id: category.data?.id, note: "app write",
      });
      check(forbidden(result), `expected 403 connector.forbidden, got ${result.status} ${short(result.json?.code)} ${short(result.json?.message)}`);
    });
    await attempt("PATCH /rest/v1/transactions", async () => {
      const result = await rest(appToken, "PATCH", "transactions?id=not.is.null", { amount_minor: 1 });
      check(forbidden(result), `expected 403 connector.forbidden, got ${result.status} ${short(result.json?.code)} ${short(result.json?.message)}`);
    });
    await attempt("DELETE /rest/v1/wallets", async () => {
      const result = await rest(appToken, "DELETE", "wallets?id=not.is.null");
      check(forbidden(result), `expected 403 connector.forbidden, got ${result.status} ${short(result.json?.code)} ${short(result.json?.message)}`);
    });
    for (const [name, body] of [
      ["create_currency", { p_code: "APP", p_symbol: "A", p_decimal_places: 2 }],
      ["settle_and_delete_wallet", { p_request_id: randomUUID(), p_wallet_id: randomUUID(), p_settlements: [] }],
      ["rotate_invoice_link", { p_folder: randomUUID(), p_owner_name: "App" }],
    ]) {
      await attempt(`POST /rest/v1/rpc/${name}`, async () => {
        const result = await rest(appToken, "POST", `rpc/${name}`, body);
        check(forbidden(result), `expected 403 connector.forbidden, got ${result.status} ${short(result.json?.code)} ${short(result.json?.message)}`);
      });
    }
    await attempt("no row written", async () => {
      const after = { transactions: await count("transactions"), wallets: await count("wallets") };
      check(after.transactions === before.transactions && after.wallets === before.wallets,
        `rows changed: transactions ${before.transactions} → ${after.transactions}, wallets ${before.wallets} → ${after.wallets}`);
    });
    finish(`(b) A's OAuth token on the database API: GET /rest/v1/wallets 200 (A's ${before.wallets} wallet); POST and PATCH /rest/v1/transactions, DELETE /rest/v1/wallets, and /rpc/create_currency, /rpc/settle_and_delete_wallet, /rpc/rotate_invoice_link each 403 connector.forbidden; A still has ${before.transactions} transaction(s) and ${before.wallets} wallet(s)`);
  });

  // (e) What the app's token can do to the password (Auth API; secure_password_change = true).
  // Always printed as MEASURED. A change FAILS the group unless MCP_ACCEPT_PASSWORD_RESIDUAL=1.
  await group(async () => {
    const { outcome, changed } = await tryPasswordChange(a, appToken, "A's OAuth app token (session just created)");
    if (changed && !ACCEPT_PASSWORD_RESIDUAL) {
      throw new Error(`(e) RESIDUAL: a connected app's token CHANGED the account password (PUT /auth/v1/user → ${outcome}). ` +
        "Supabase Auth counts the app's fresh session as a recent sign-in. Set MCP_ACCEPT_PASSWORD_RESIDUAL=1 only once the owner has accepted this.");
    }
    ok(`(e) PUT /auth/v1/user with a new password and A's app token: ${outcome}${changed ? " (accepted by MCP_ACCEPT_PASSWORD_RESIDUAL=1)" : ""}`);
  });

  // (e2) Self-approval: can the app's own access token approve a NEW authorization request for the
  // same app, and so get itself a fresh session (and with it a fresh 24 h password window)? A
  // separate person P, so no password change here touches A's sessions. P's first app session is
  // aged to 25 h in the local database first, so the probe also shows whether the 24 h window
  // closes for an old session. Every answer is printed as MEASURED; a working self-approval, or a
  // password change by either token, FAILS the group unless MCP_ACCEPT_PASSWORD_RESIDUAL=1.
  await group(async () => {
    const p = await makeUser("p");
    const old = await oauthTokens(p, appClientId);
    const oldClaims = claimsOf(old.accessToken);
    check(UUID.test(String(oldClaims.session_id)) && UUID.test(String(p.id)), "P's app token has no canonical session_id");
    const aged = localSql(`update auth.sessions set created_at = now() - interval '25 hours' where id = '${oldClaims.session_id}' and user_id = '${p.id}' returning 1`);
    const agedOk = aged !== null && aged.split("\n")[0] === "1";
    console.log(`     P's first app session created_at moved back 25 h in the local database: ${agedOk ? "yes" : "NO (could not ask the local db container)"}`);
    const oldTry = await tryPasswordChange(p, old.accessToken, `P's app token (session ${agedOk ? "aged 25 h" : "fresh"})`);

    // The app's token, as a bearer, on the consent screen's own two calls.
    const flow = await startAuthorization({ apiUrl, publishable, clientId: appClientId, redirectUri: APP_REDIRECT });
    const bearer = { apikey: publishable, authorization: `Bearer ${old.accessToken}`, "content-type": "application/json" };
    const detailsResponse = await fetch(`${apiUrl}/auth/v1/oauth/authorizations/${flow.authorizationId}`, { headers: bearer });
    const details = await detailsResponse.json().catch(() => ({}));
    const detailsOutcome = detailsResponse.ok
      ? `${detailsResponse.status}${typeof details.redirect_url === "string" ? " (auto-approved: redirect_url)" : ""}`
      : `${detailsResponse.status} ${details.error_code ?? details.code ?? ""}`;
    let redirectUrl = typeof details.redirect_url === "string" ? details.redirect_url : null;
    let consentOutcome = "not tried";
    if (!redirectUrl && detailsResponse.ok) {
      const consent = await fetch(`${apiUrl}/auth/v1/oauth/authorizations/${flow.authorizationId}/consent`, {
        method: "POST", headers: bearer, body: JSON.stringify({ action: "approve" }),
      });
      const json = await consent.json().catch(() => ({}));
      consentOutcome = consent.ok ? `${consent.status}${typeof json.redirect_url === "string" ? " redirect_url" : " (no redirect_url)"}` : `${consent.status} ${json.error_code ?? json.code ?? ""}`;
      if (consent.ok && typeof json.redirect_url === "string") redirectUrl = json.redirect_url;
    }
    let selfApproved = false;
    let fresh = null;
    let freshSession = "none";
    if (redirectUrl) {
      const code = codeFromRedirect(redirectUrl, { redirectUri: APP_REDIRECT, state: flow.state });
      const tokens = await exchangeCode({ apiUrl, publishable, clientId: appClientId, redirectUri: APP_REDIRECT, code, verifier: flow.verifier });
      const claims = claimsOf(tokens.accessToken);
      selfApproved = claims.client_id === appClientId && claims.sub === p.id;
      freshSession = claims.session_id === oldClaims.session_id ? "the SAME session" : "a NEW session";
      fresh = tokens.accessToken;
    }
    console.log(`     MEASURED self-approval with P's app token as bearer: GET /oauth/authorizations/{id} → ${detailsOutcome}; POST …/consent approve → ${consentOutcome}; ` +
      `${selfApproved ? `code exchanged for an app token with ${freshSession}` : "no app token obtained"}`);
    const freshTry = fresh ? await tryPasswordChange(p, fresh, "the self-approved app token") : null;
    const residual = selfApproved || oldTry.changed || Boolean(freshTry?.changed);
    if (residual && !ACCEPT_PASSWORD_RESIDUAL) {
      throw new Error(`(e2) RESIDUAL: self-approval ${selfApproved ? "WORKS" : "refused"}; password change by the ${agedOk ? "25 h old" : "first"} app session ${oldTry.changed ? "WORKED" : "refused"}` +
        `${freshTry ? `, by the self-approved one ${freshTry.changed ? "WORKED" : "refused"}` : ""}. Set MCP_ACCEPT_PASSWORD_RESIDUAL=1 only once the owner has accepted this.`);
    }
    ok(`(e2) self-approval by the app's own token: ${selfApproved ? `WORKS (${freshSession})` : "refused"}; password change with the ${agedOk ? "25 h old" : "first"} app session: ${oldTry.outcome}` +
      `${freshTry ? `; with the self-approved token: ${freshTry.outcome}` : ""}${residual ? " (accepted by MCP_ACCEPT_PASSWORD_RESIDUAL=1)" : ""}`);
  });

  // (f) The person removes the app (revokeGrant, what Settings will call). B approves the app (so
  // A's token, used by (c) below, is untouched), then revokes it as B. ASSERTED: the access token
  // issued before the revocation is refused by the database API at once (the guard finds its
  // session gone) and by /mcp within 60 s (its approved-app lookup goes through that guard; a
  // positive answer is cached 60 s per app). MEASURED (printed, not asserted): the same token at
  // the Auth API (PUT /auth/v1/user with harmless metadata), the refresh token at the token
  // endpoint, and what revokeGrant answers for an app that has no grant (already removed / never
  // approved). Every credential is polled every 2 s for up to 75 s, stopping at its first refusal.
  // MCP_TEST_BREAK_REVOKE=1 revokes a random client id instead (the group then fails), to show
  // that the cleanup in `finally` still removes everything this group made.
  await group(async () => {
    const { accessToken, refreshToken: firstRefresh } = await oauthTokens(b, appClientId);
    const claims = claimsOf(accessToken);
    const probes = {
      mcp: async () => {
        const response = await rawPost({ authorization: `Bearer ${accessToken}` });
        await response.body?.cancel();
        return { accepted: response.status === 200, outcome: `${response.status}${response.status === 401 && (response.headers.get("www-authenticate") ?? "").includes("invalid_token") ? " invalid_token" : ""}` };
      },
      database: async () => {
        const result = await rest(accessToken, "GET", "wallets?select=id");
        return { accepted: result.status === 200, outcome: `${result.status}${result.json?.code ? ` ${result.json.code}` : ""}${result.json?.message ? ` "${short(result.json.message)}"` : ""}` };
      },
      authApi: async () => {
        const response = await fetch(`${apiUrl}/auth/v1/user`, {
          method: "PUT",
          headers: { apikey: publishable, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ data: { probe: true } }),
        });
        return { accepted: response.ok, outcome: await authOutcome(response) };
      },
    };
    // A refresh that works rotates the token, so the newest one is kept for the next try (never printed).
    let refreshToken = firstRefresh;
    probes.refresh = async () => {
      const response = await fetch(`${apiUrl}/auth/v1/oauth/token`, {
        method: "POST",
        headers: { apikey: publishable, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: appClientId }),
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok && typeof json.refresh_token === "string") refreshToken = json.refresh_token;
      return { accepted: response.ok && typeof json.access_token === "string", outcome: `${response.status}${json.error_code ?? json.error ? ` ${json.error_code ?? json.error}` : ""}` };
    };

    // Preconditions: every credential works before the revocation, and the grant is listed for B.
    for (const name of ["mcp", "database", "authApi"]) {
      const before = await probes[name]();
      check(before.accepted, `before revocation, ${name} should accept B's app token, got ${before.outcome}`);
    }
    // A refresh before the revocation: the new access token belongs to the same session and works
    // at /mcp and the database. The rotated refresh token is the one tried after the revocation.
    {
      const response = await fetch(`${apiUrl}/auth/v1/oauth/token`, {
        method: "POST",
        headers: { apikey: publishable, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: appClientId }),
      });
      const json = await response.json().catch(() => ({}));
      check(response.ok && typeof json.access_token === "string" && typeof json.refresh_token === "string",
        `refresh before revocation: ${response.status} ${short(json.error_code ?? json.error ?? "")}`);
      refreshToken = json.refresh_token;
      const refreshedClaims = claimsOf(json.access_token);
      check(refreshedClaims.session_id === claims.session_id && refreshedClaims.client_id === appClientId && refreshedClaims.sub === b.id,
        "the refreshed access token does not carry the same session, app and user");
      const atMcp = await rawPost({ authorization: `Bearer ${json.access_token}` });
      await atMcp.body?.cancel();
      const atDb = await rest(json.access_token, "GET", "wallets?select=id");
      check(atMcp.status === 200 && atDb.status === 200, `the refreshed token should get 200 from /mcp and the database, got ${atMcp.status} / ${atDb.status} ${short(atDb.json?.message ?? "")}`);
      console.log(`     refreshed B's app token before revocation: same session_id, /mcp ${atMcp.status}, database read ${atDb.status}`);
    }
    // The guard ties a session to its user and app: confirm Supabase stores the app's public
    // client id (the token's client_id claim) and the user on the session row.
    if (UUID.test(String(claims.session_id))) {
      const stored = localSql(`select oauth_client_id::text || ':' || user_id::text from auth.sessions where id = '${claims.session_id}'`);
      if (stored === null) console.log("     (session row's oauth_client_id: unknown, the local db container could not be asked)");
      else check(stored === `${appClientId}:${b.id}`, "auth.sessions.oauth_client_id / user_id of B's app session differ from the token's client_id / sub");
      if (stored !== null) console.log("     auth.sessions row of B's app session: oauth_client_id = the token's client_id, user_id = its sub");
    }
    const listed = await b.auth.auth.oauth.listGrants();
    check(!listed.error && Array.isArray(listed.data), `listGrants as B: ${short(listed.error?.message)}`);
    const mine = listed.data.find((g) => g.client?.id === appClientId);
    check(mine, "B's listGrants does not show the app B just approved");
    console.log(`     listGrants as B: ${listed.data.length} grant(s); this one has keys ${short(Object.keys(mine).sort())}, client keys ${short(Object.keys(mine.client).sort())}, granted_at ${typeof mine.granted_at === "string" && !Number.isNaN(Date.parse(mine.granted_at)) ? "an ISO date" : short(mine.granted_at)}`);
    const sessionBefore = sessionRowExists(claims.session_id, b.id);
    check(sessionBefore !== false, "B's app session is not in auth.sessions even before revocation");
    // A's own grant for the same app, from a fresh password sign-in (group (e) may have changed
    // A's password, which ends A's earlier password session): listed now, so "still listed" counts.
    const aAuth = createClient(apiUrl, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const aSigned = await aAuth.auth.signInWithPassword({ email: a.email, password: a.password });
    check(!aSigned.error && aSigned.data.session, `fresh sign-in as A: ${short(aSigned.error?.message)}`);
    const aListed = async () => {
      const grants = await aAuth.auth.oauth.listGrants();
      check(!grants.error && Array.isArray(grants.data), `listGrants as A: ${short(grants.error?.message)}`);
      return grants.data.some((g) => g.client?.id === appClientId);
    };
    check(await aListed(), "A's listGrants does not show the app A approved, so a later 'still listed' would prove nothing");

    const revokeTarget = process.env.MCP_TEST_BREAK_REVOKE === "1" ? randomUUID() : appClientId;
    const revoked = await b.auth.auth.oauth.revokeGrant({ clientId: revokeTarget });
    check(!revoked.error, `revokeGrant as B: ${short(revoked.error?.message)}`);
    const revokedAt = Date.now();
    const sessionAfter = sessionRowExists(claims.session_id, b.id);

    // The database answer right after the revocation, before any waiting.
    const dbAtOnce = await rest(accessToken, "GET", "wallets?select=id");

    // Meanwhile A keeps using the same app with A's own valid token, first in every round, so
    // A's lookups would refill an approved-app cache shared by the whole app: B must still be
    // shut out (the cache is per app and session) and A must keep getting 200.
    const aAtMcp = [];
    const WINDOW_MS = 75_000;
    const results = {};
    const pending = new Set(Object.keys(probes));
    for (;;) {
      const elapsed = Date.now() - revokedAt;
      const aResponse = await rawPost({ authorization: `Bearer ${appA.token}` });
      await aResponse.body?.cancel();
      aAtMcp.push(aResponse.status);
      for (const name of [...pending]) {
        const { accepted, outcome } = await probes[name]();
        results[name] = { accepted, outcome, at: elapsed };
        if (!accepted) pending.delete(name);
      }
      if (pending.size === 0 || Date.now() - revokedAt >= WINDOW_MS) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    // revokeGrant for an app that has no grant: the same app again (already removed), and an id
    // that was never approved. Recorded as facts (Settings' Remove must be harmless on a repeat).
    const describeRevoke = (result) => (result.error
      ? `error ${result.error.name ?? ""} status ${result.error.status ?? "-"} code ${result.error.code ?? "-"} "${short(result.error.message ?? "")}"`
      : "no error");
    const again = await b.auth.auth.oauth.revokeGrant({ clientId: appClientId });
    const never = await b.auth.auth.oauth.revokeGrant({ clientId: randomUUID() });

    const remaining = Math.max(0, claims.exp - Math.floor(Date.now() / 1000));
    const line = (name, label) => {
      const r = results[name];
      return r.accepted
        ? `${label}: STILL ACCEPTED after ${Math.round((Date.now() - revokedAt) / 1000)} s (last ${r.outcome})`
        : `${label}: refused ${r.at < 1000 ? "at once" : `after ${Math.round(r.at / 1000)} s`} (${r.outcome})`;
    };
    const describeSession = (value) => (value === null ? "unknown (no local db container)" : value ? "present" : "DELETED");
    const aStillListed = await aListed();
    const bGrants = await b.auth.auth.oauth.listGrants();
    const bStillListed = !bGrants.error && Array.isArray(bGrants.data) && bGrants.data.some((g) => g.client?.id === appClientId);
    console.log("     ---------------- revokeGrant by the person ----------------");
    console.log(`     database API right after revoke: ${dbAtOnce.status} ${short(dbAtOnce.json?.code ?? "")} ${short(dbAtOnce.json?.message ?? "")}`);
    console.log(`     ${line("mcp", "access token at /mcp            ")}`);
    console.log(`     ${line("database", "access token at the database API")}`);
    console.log(`     MEASURED ${line("authApi", "access token at PUT /auth/v1/user")}`);
    console.log(`     MEASURED ${line("refresh", "refresh token at /oauth/token   ")}`);
    console.log(`     MEASURED auth.sessions row of the app session: before ${describeSession(sessionBefore)}, after ${describeSession(sessionAfter)}`);
    console.log(`     MEASURED revokeGrant again for the removed app: ${describeRevoke(again)}`);
    console.log(`     MEASURED revokeGrant for an app B never approved: ${describeRevoke(never)}`);
    console.log(`     access token lifetime left (exp claim): ${remaining} s of ${claims.exp - claims.iat} s`);
    console.log(`     B's grant listed after revoke: ${bStillListed}; A's grant for the same app still listed: ${aStillListed}`);
    console.log("     ------------------------------------------------------------");
    check(aStillListed, "B's revokeGrant removed A's grant for the same app");
    check(!bStillListed, "B's grant is still listed after revokeGrant");
    check(forbidden(dbAtOnce), `right after revokeGrant the database API should refuse the old token (403 connector.forbidden), got ${dbAtOnce.status} ${short(dbAtOnce.json?.code)}`);
    check(!results.mcp.accepted, `/mcp still accepted the old token ${Math.round(WINDOW_MS / 1000)} s after revokeGrant (last ${results.mcp.outcome})`);
    check(results.mcp.outcome === "401 invalid_token", `/mcp refused the old token with ${results.mcp.outcome}, expected 401 invalid_token`);
    check(results.mcp.at <= 65_000, `/mcp took ${Math.round(results.mcp.at / 1000)} s to refuse the old token (expected within 60 s)`);
    console.log(`     A's own token for the same app at /mcp during the wait: ${aAtMcp.length} calls, statuses ${short([...new Set(aAtMcp)])}`);
    check(aAtMcp.length >= 2 && aAtMcp.every((status) => status === 200), `A's valid token for the same app did not keep getting 200 at /mcp: ${short(aAtMcp)}`);
    ok(`(f) after revokeGrant as B (B's token refreshed once before, same session), the earlier access token got 403 connector.forbidden from the database API at once and 401 invalid_token from /mcp after ${Math.round(results.mcp.at / 1000)} s while A used the same app every round (${aAtMcp.length} × 200); measured: Auth API ${results.authApi.accepted ? "still accepts" : "refuses"} it, refresh token ${results.refresh.accepted ? "still works" : "refused"}; A's grant untouched`);
  });

  // (g) The person signs out of the browser: `signOut()` with its default (global) scope, exactly
  // what the app's Sign out calls (src/features/auth/actions.ts). A third person C, so A's and B's
  // sessions are untouched. MEASURED only (sign-out behaviour is the owner's decision): whether the
  // app's earlier access token still works at the database API and /mcp (polled every 2 s for up
  // to 75 s, stopping at the first refusal), whether its refresh token still works, whether its
  // session row survives, and whether listGrants (after a fresh sign-in) still lists the app.
  await group(async () => {
    const c = await makeUser("c");
    const { accessToken, refreshToken } = await oauthTokens(c, appClientId);
    const claims = claimsOf(accessToken);
    const atMcp = async () => {
      const response = await rawPost({ authorization: `Bearer ${accessToken}` });
      await response.body?.cancel();
      return response.status;
    };
    const atDb = async () => (await rest(accessToken, "GET", "wallets?select=id")).status;
    // Preconditions: the app works for C and is listed for C (this also warms /mcp's 60 s cache).
    check((await atMcp()) === 200, "before sign-out, /mcp should accept C's app token");
    check((await atDb()) === 200, "before sign-out, the database should accept C's app token");
    const listedBefore = await c.auth.auth.oauth.listGrants();
    check(!listedBefore.error && listedBefore.data?.some((g) => g.client?.id === appClientId), "before sign-out, C's listGrants does not show the app");
    const sessionBefore = sessionRowExists(claims.session_id, c.id);

    const signedOut = await c.auth.auth.signOut();
    check(!signedOut.error, `signOut() as C: ${short(signedOut.error?.message)}`);
    const signedOutAt = Date.now();
    const passwordSession = await fetch(`${apiUrl}/auth/v1/user`, { headers: { apikey: publishable, authorization: `Bearer ${c.token}` } });
    const passwordOutcome = await authOutcome(passwordSession);
    const dbAtOnce = await atDb();
    const sessionAfter = sessionRowExists(claims.session_id, c.id);
    let mcpStatus = await atMcp();
    let mcpRefusedAfter = mcpStatus === 200 ? null : 0;
    while (mcpRefusedAfter === null && Date.now() - signedOutAt < 75_000) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      mcpStatus = await atMcp();
      if (mcpStatus !== 200) mcpRefusedAfter = Date.now() - signedOutAt;
    }
    const authApi = await authOutcome(await fetch(`${apiUrl}/auth/v1/user`, { headers: { apikey: publishable, authorization: `Bearer ${accessToken}` } }));
    const refreshed = await refreshAppTokens({ apiUrl, publishable, clientId: appClientId, refreshToken });
    const again = createClient(apiUrl, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await again.auth.signInWithPassword({ email: c.email, password: c.password });
    check(!signedIn.error && signedIn.data.session, `fresh sign-in as C after sign-out: ${short(signedIn.error?.message)}`);
    const listedAfter = await again.auth.oauth.listGrants();
    check(!listedAfter.error && Array.isArray(listedAfter.data), `listGrants as C after sign-out: ${short(listedAfter.error?.message)}`);
    const stillListed = listedAfter.data.some((g) => g.client?.id === appClientId);
    const describeSession = (value) => (value === null ? "unknown (no local db container)" : value ? "present" : "DELETED");
    const mcpLine = mcpRefusedAfter === null
      ? `STILL ACCEPTED after ${Math.round((Date.now() - signedOutAt) / 1000)} s`
      : `refused ${mcpRefusedAfter === 0 ? "at once" : `after ${Math.round(mcpRefusedAfter / 1000)} s`} (${mcpStatus})`;
    console.log("     ---------------- signOut() (global) by the person ----------------");
    console.log(`     C's password session at GET /auth/v1/user after sign-out: ${passwordOutcome}`);
    console.log(`     MEASURED app access token at the database API right after sign-out: ${dbAtOnce}`);
    console.log(`     MEASURED app access token at /mcp: ${mcpLine}`);
    console.log(`     MEASURED app access token at GET /auth/v1/user: ${authApi}`);
    console.log(`     MEASURED app refresh token at /oauth/token: ${refreshed.ok ? "STILL WORKS" : `refused (${refreshed.status} ${refreshed.error})`}`);
    console.log(`     MEASURED auth.sessions row of the app session: before ${describeSession(sessionBefore)}, after ${describeSession(sessionAfter)}`);
    console.log(`     MEASURED listGrants after a fresh sign-in still lists the app: ${stillListed}`);
    console.log("     ------------------------------------------------------------------");
    ok(`(g) after C's global signOut(): app token at the database ${dbAtOnce === 200 ? "still accepted" : `refused (${dbAtOnce})`}, at /mcp ${mcpLine}; refresh ${refreshed.ok ? "still works" : "refused"}; ` +
      `the app is ${stillListed ? "STILL listed" : "no longer listed"} in Settings (listGrants) — measured, not asserted`);
  });

  // (c) Removing the app: the database refuses its still-valid token at once, /mcp within 60 s.
  await group(async () => {
    const warm = await rawPost({ authorization: `Bearer ${appToken}` });
    check(warm.status === 200, `before removal the app token should reach /mcp (200), got ${warm.status}`);
    const removed = await admin.from("connector_clients").delete().eq("client_id", appClientId);
    check(!removed.error, `delete from connector_clients: ${short(removed.error?.message)}`);
    const removedAt = Date.now();
    const db = await rest(appToken, "GET", "wallets?select=id");
    check(forbidden(db), `right after removal the database should refuse the token (403 connector.forbidden), got ${db.status} ${short(db.json?.message)}`);
    let refusedAfter = null;
    let lastStatus = 0;
    while (Date.now() - removedAt < REMOVAL_GRACE_MS) {
      const response = await rawPost({ authorization: `Bearer ${appToken}` });
      lastStatus = response.status;
      await response.body?.cancel();
      if (response.status === 401 && (response.headers.get("www-authenticate") ?? "").includes("invalid_token")) {
        refusedAfter = Date.now() - removedAt;
        break;
      }
      check(response.status === 200, `while waiting, /mcp answered ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    check(refusedAfter !== null, `/mcp still accepted the removed app's token after ${REMOVAL_GRACE_MS / 1000} s (last status ${lastStatus})`);
    check(refusedAfter <= 65_000, `/mcp took ${Math.round(refusedAfter / 1000)} s to refuse the removed app (expected within 60 s)`);
    ok(`(c) after the app's connector_clients row was deleted, its still-valid token got 403 connector.forbidden from the database at once, and 401 invalid_token from /mcp after ${Math.round(refusedAfter / 1000)} s (was 200 just before)`);
  });

  // (d) Self-registration is off. Each check names the exact answer, so a wrong path (404) or a
  // failed metadata fetch cannot pass it.
  await group(async () => {
    const response = await fetch(`${apiUrl}/auth/v1/oauth/clients/register`, {
      method: "POST",
      headers: { apikey: publishable, "content-type": "application/json" },
      body: JSON.stringify({ client_name: "self-registered", redirect_uris: ["http://localhost:8977/callback"], token_endpoint_auth_method: "none" }),
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok && json.client_id) await admin.auth.admin.oauth.deleteClient(json.client_id);
    check(response.status === 403 && json.error_code === "oauth_dynamic_client_registration_disabled" && !json.client_id,
      `dynamic registration: expected 403 oauth_dynamic_client_registration_disabled, got ${response.status} ${short(json.error_code ?? json.error ?? "")}`);
    const metaResponse = await fetch(`${apiUrl}/auth/v1/.well-known/oauth-authorization-server`, { headers: { accept: "application/json" } });
    check(metaResponse.ok, `authorization server metadata: ${metaResponse.status}`);
    const meta = await metaResponse.json();
    check(typeof meta.issuer === "string" && meta.issuer.replace(/\/+$/, "") === `${apiUrl}/auth/v1`,
      `authorization server metadata has no issuer ${apiUrl}/auth/v1 (got ${short(meta.issuer)}), so it is not the document checked`);
    check(typeof meta.authorization_endpoint === "string" && typeof meta.token_endpoint === "string", "authorization server metadata lacks its endpoints");
    check(!("registration_endpoint" in meta), "the authorization server metadata still advertises a registration_endpoint");
    ok(`(d) dynamic registration at ${apiUrl}/auth/v1/oauth/clients/register is refused (403 oauth_dynamic_client_registration_disabled); the authorization server metadata (issuer ${meta.issuer}) has no registration_endpoint`);
  });
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  let cleaned = true;
  if (appClientId) {
    await admin.from("connector_clients").delete().eq("client_id", appClientId);
    await admin.auth.admin.oauth.deleteClient(appClientId);
    const row = await admin.from("connector_clients").select("client_id", { count: "exact", head: true }).eq("client_id", appClientId);
    const still = await admin.auth.admin.oauth.getClient(appClientId);
    if (row.error || row.count !== 0 || !still.error) {
      cleaned = false;
      console.error(`FAIL cleanup: the test app was not fully removed (row: ${row.error?.message ?? row.count}, OAuth client still present: ${!still.error})`);
    }
  }
  // Deleting the auth user cascades to every row the user owns.
  for (const id of users) {
    // Known app defect, not the connector's: Supabase Auth cannot delete an account that has a
    // budget row or loan entries. The cascade fires triggers that run as the Auth role, which may
    // not read public.currencies (ledger_private.budget_disabled_dependency_guard) or public.loans.
    // Group (w) creates both, so when the admin API fails the user is deleted as postgres in the
    // local database container (this script only ever runs against the local stack).
    let removed = await admin.auth.admin.deleteUser(id);
    if (removed.error && UUID.test(String(id)) && localSql(`delete from auth.users where id = '${id}' returning 1`) !== null) {
      console.log("     (the admin API could not delete a test user with budgets/loans; deleted it in the local database instead)");
      removed = { error: null };
    }
    const gone = await admin.auth.admin.getUserById(id);
    if (removed.error || gone.data?.user) {
      cleaned = false;
      console.error(`FAIL cleanup: test user ${id} not deleted: ${removed.error?.message ?? "still present"}`);
    }
    for (const [table, column] of [["transactions", "user_id"], ["wallets", "user_id"], ["invoice_folders", "owner_id"]]) {
      const left = await admin.from(table).select("id", { count: "exact", head: true }).eq(column, id);
      if (left.error || left.count !== 0) {
        cleaned = false;
        console.error(`FAIL cleanup: ${table} rows remain for ${id}: ${left.error?.message ?? left.count}`);
      }
    }
  }
  // What Supabase Auth itself kept for them (sessions, consents from approvals, authorization
  // requests): gone by cascade with the users and the app, whether or not any group passed.
  if (users.length || appClientId) {
    const left = authRowsLeft(users, appClientId);
    if (left === null) {
      console.log("     (auth rows left for the test users/app: unknown, the local db container could not be asked)");
    } else if (left !== "0:0:0") {
      cleaned = false;
      console.error(`FAIL cleanup: Supabase Auth rows remain for the test users/app (sessions:consents:authorizations = ${left})`);
    } else {
      console.log("     (auth rows left for the test users/app: sessions:consents:authorizations = 0:0:0)");
    }
  }
  if (users.length && cleaned) ok(`cleanup: deleted the ${users.length} test users${appClientId ? " and the test app (OAuth client + connector_clients row)" : ""}; no transactions, wallets or invoice folders remain for them`);
  if (!cleaned) process.exitCode = 1;
  console.log(process.exitCode ? `# FAILED: ${groups} groups ok, ${failed || "setup or cleanup"} failed` : `# all ${groups} groups ok`);
}
