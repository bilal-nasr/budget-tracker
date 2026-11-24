// Proves the connector's database guard on a Supabase project: a registered app's token can read
// and cannot write. Run it after every deploy and every Supabase upgrade (the guard lives in a role
// setting; if that setting is lost, app tokens FAIL OPEN and can write).
//
//   pnpm connector:smoke
//
// Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY from
// the environment (the npm script loads .env.local; variables already set in the shell win over the
// file). For anything but 127.0.0.1/localhost it prints the host and waits for you to type it back
// before it sends anything there.
//
// It creates a THROWAWAY confirmed user (signed in with a one-time admin link, so no email and no
// CAPTCHA) and a THROWAWAY public OAuth app (recorded in connector_clients), approves the app as
// that user without a browser, and checks, one PASS/FAIL line each:
//   1. an ordinary sign-in session reads the database (control: ordinary sessions are untouched);
//   2. the app token reads (GET /rest/v1/wallets → 200);
//   3. the app token cannot write (POST /rest/v1/rpc/create_wallet → 403 connector.forbidden) and no row is written;
//   4. GraphQL refuses the app token (or GraphQL is not exposed on this project);
//   5. a refreshed app token still carries client_id and session_id and is still read-only;
//   6. after the person removes the app (revokeGrant), the database refuses the token.
// The user and the app are deleted in `finally`, whatever happened. It never prints keys or tokens.
// Exit code 0 means every check passed.
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { claimsOf, headlessAppTokens, refreshAppTokens } from "./lib/connector-oauth.mjs";

// Nothing listens here: the code is read from the approval's redirect_url.
const REDIRECT = "http://localhost:8976/callback";

function stop(message) {
  console.error(message);
  process.exit(1);
}

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !publishable || !secret) {
  stop("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (in .env.local for `pnpm connector:smoke`).");
}
let host;
try {
  host = new URL(url).hostname;
} catch {
  stop("NEXT_PUBLIC_SUPABASE_URL is not a valid address.");
}

// Confirmation before anything is sent to a project that is not on this machine.
async function confirmHost() {
  if (host === "127.0.0.1" || host === "localhost") return;
  console.log(`This creates and then deletes a throwaway user and a throwaway OAuth app on the Supabase project at: ${host}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  // stdin closing without an answer (nothing typed) is a "no".
  const closed = new Promise((resolve) => prompt.once("close", () => resolve(null)));
  const typed = await Promise.race([prompt.question("Type the host above to continue: "), closed]);
  prompt.close();
  if (typeof typed !== "string" || typed.trim() !== host) stop("Not confirmed; nothing was sent.");
}

const short = (value) => {
  const text = typeof value === "string" ? value : String(JSON.stringify(value));
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
};

let failures = 0;
function report(passed, label, why = "") {
  if (passed) console.log(`PASS ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${why ? `\n     ${why}` : ""}`);
  }
}

async function rest(token, method, path, body) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
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
const describe = (result) => `${result.status}${result.json?.code ? ` ${result.json.code}` : ""}${result.json?.message ? ` "${short(result.json.message)}"` : ""}`;

async function graphql(token) {
  const response = await fetch(`${url}/graphql/v1`, {
    method: "POST",
    headers: { apikey: publishable, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "{ __typename }" }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text };
}

await confirmHost();
console.log(`# connector smoke check on ${host}`);
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

let userId = null;
let clientId = null;
try {
  // A throwaway confirmed user, signed in with a one-time admin link (no email is sent).
  const email = `connector-smoke-${randomBytes(6).toString("hex")}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`could not create the throwaway user: ${short(created.error?.message)}`);
  userId = created.data.user.id;
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error(`could not make a sign-in link for the throwaway user: ${short(link.error?.message)}`);
  const person = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await person.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  const session = verified.data?.session;
  if (verified.error || !session) throw new Error(`could not sign the throwaway user in: ${short(verified.error?.message)}`);

  // A throwaway public (PKCE) app, registered as `pnpm connector:register` does.
  const registered = await admin.auth.admin.oauth.createClient({
    client_name: `connector-smoke-${randomBytes(4).toString("hex")}`,
    redirect_uris: [REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  if (registered.error || !registered.data?.client_id) {
    throw new Error(`could not create the throwaway OAuth app: ${short(registered.error?.message)} (is the OAuth server on?)`);
  }
  clientId = registered.data.client_id;
  const listed = await admin.from("connector_clients").insert({ client_id: clientId, name: registered.data.client_name });
  if (listed.error) throw new Error(`could not record the throwaway app in connector_clients: ${short(listed.error.message)} (are the migrations applied?)`);
  const tokens = await headlessAppTokens({ apiUrl: url, publishable, approver: person, clientId, redirectUri: REDIRECT, expectedUserId: userId, label: "the throwaway user" });
  const claims = claimsOf(tokens.accessToken);
  console.log(`#   throwaway user and app created; the app token carries client_id ${claims.client_id === clientId ? "= the app" : "MISMATCH"} and a session_id`);

  // 1. Control: an ordinary session is untouched by the guard.
  const sessionRead = await rest(session.access_token, "GET", "wallets?select=id");
  report(sessionRead.status === 200, `ordinary sign-in session: GET /rest/v1/wallets → ${describe(sessionRead)}`,
    "Ordinary sessions return from the guard before any path or session check. If they are refused, something other than the guard is wrong (RLS, grants, the API itself): roll back and investigate.");

  // 2. The app token reads.
  const appRead = await rest(tokens.accessToken, "GET", "wallets?select=id");
  report(appRead.status === 200, `app token: GET /rest/v1/wallets → ${describe(appRead)}`,
    "A 403 here means the guard refuses this app's reads: its owner cannot read auth.sessions, or auth.sessions.oauth_client_id is not the app's client id " +
    "(connector_clients.client_id must be its lower-case uuid text), or request.path has a shape the guard does not parse (it expects /name or /rpc/name). Roll back and report it.");

  // 3. The app token cannot write, and nothing is written.
  const count = async () => {
    const result = await admin.from("wallets").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (result.error) throw new Error(`could not count the throwaway user's wallets: ${short(result.error.message)}`);
    return result.count;
  };
  const before = await count();
  const write = await rest(tokens.accessToken, "POST", "rpc/create_wallet", { p_name: "Smoke wallet", p_kind: "cash", p_default_currency: "USD", p_opening_minor: 0 });
  const after = await count();
  report(forbidden(write) && after === before, `app token: POST /rest/v1/rpc/create_wallet → ${describe(write)}; wallets ${before} → ${after}`,
    "Anything but 403 connector.forbidden means the pre-request hook is NOT running and app tokens can write (fail open). " +
    "Set it again at once: alter role authenticator set pgrst.db_pre_request = 'public.connector_request_guard'; notify pgrst, 'reload config';");

  // 4. GraphQL: refused for the app; an ordinary session shows whether it is exposed at all.
  const gqlSession = await graphql(session.access_token);
  const gqlApp = await graphql(tokens.accessToken);
  const exposed = gqlSession.status === 200 && gqlSession.json && !gqlSession.json.errors?.length;
  const appRefused = gqlApp.status === 403 || /connector\.forbidden/.test(gqlApp.text);
  if (exposed) {
    report(appRefused, `GraphQL: ordinary session → ${gqlSession.status}; app token → ${gqlApp.status}${appRefused ? " refused" : ""}`,
      "GraphQL answers the app token. Turn the pg_graphql extension off, or roll back.");
  } else {
    report(!(gqlApp.status === 200 && gqlApp.json && !gqlApp.json.errors?.length),
      `GraphQL not exposed here (an ordinary session gets ${gqlSession.status}${gqlSession.json?.errors?.length ? " with an error, e.g. pg_graphql not enabled" : ""}); app token → ${gqlApp.status}${appRefused ? " refused" : ""}`,
      "GraphQL answers the app token although it does not answer an ordinary session. Investigate.");
  }

  // 5. A refreshed token keeps client_id and session_id and stays read-only.
  const refreshed = await refreshAppTokens({ apiUrl: url, publishable, clientId, refreshToken: tokens.refreshToken });
  if (!refreshed.ok) {
    report(false, `refresh at /auth/v1/oauth/token → ${refreshed.status} ${refreshed.error}`, "The app could not refresh its token. Report it.");
  } else {
    const next = claimsOf(refreshed.accessToken);
    const keeps = next.client_id === clientId && next.session_id === claims.session_id && next.sub === userId;
    const nextRead = await rest(refreshed.accessToken, "GET", "wallets?select=id");
    const nextWrite = await rest(refreshed.accessToken, "POST", "rpc/create_wallet", { p_name: "Smoke wallet", p_kind: "cash", p_default_currency: "USD", p_opening_minor: 0 });
    report(keeps && nextRead.status === 200 && forbidden(nextWrite),
      `refreshed app token: client_id ${next.client_id === clientId ? "kept" : "LOST"}, session_id ${next.session_id === claims.session_id ? "kept" : "CHANGED"}; read → ${nextRead.status}; create_wallet → ${describe(nextWrite)}`,
      "If client_id is lost the token looks like an ordinary session (and /mcp refuses it); if the read is 403 the session check fails after a refresh. Roll back and report it.");
  }

  // 6. The person removes the app: the database refuses the app's earlier token at once.
  const revoked = await person.auth.oauth.revokeGrant({ clientId });
  const afterRevoke = await rest(tokens.accessToken, "GET", "wallets?select=id");
  report(!revoked.error && forbidden(afterRevoke), `after revokeGrant: app token GET /rest/v1/wallets → ${describe(afterRevoke)}${revoked.error ? ` (revokeGrant failed: ${short(revoked.error.message)})` : ""}`,
    "The token still reads after the app was removed: the guard's session check is not working. Report it.");
} catch (error) {
  failures += 1;
  console.log(`FAIL setup: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  let cleaned = true;
  if (clientId) {
    const row = await admin.from("connector_clients").delete().eq("client_id", clientId);
    const app = await admin.auth.admin.oauth.deleteClient(clientId);
    const still = await admin.auth.admin.oauth.getClient(clientId);
    const left = await admin.from("connector_clients").select("client_id", { count: "exact", head: true }).eq("client_id", clientId);
    if (row.error || app.error || !still.error || left.error || left.count !== 0) {
      cleaned = false;
      console.log(`FAIL cleanup: the throwaway app ${clientId} was not fully removed; remove it with: pnpm connector:register --remove ${clientId}`);
    }
  }
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    const gone = await admin.auth.admin.getUserById(userId);
    if (removed.error || gone.data?.user) {
      cleaned = false;
      console.log(`FAIL cleanup: the throwaway user ${userId} was not deleted; delete it in the dashboard (Authentication, Users).`);
    }
  }
  if (cleaned && (clientId || userId)) console.log("PASS cleanup: the throwaway user and app are deleted");
  if (!cleaned) failures += 1;
  console.log(failures === 0 ? "# all checks passed" : `# ${failures} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}
