// Registers an app that may connect to the budget's /mcp connector (Claude), or removes one.
//
//   pnpm connector:register "<name>" [extra redirect address…]
//   pnpm connector:register --remove <client_id>
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the environment (the npm script
// loads .env.local). Registering creates a PUBLIC OAuth client in Supabase Auth (no secret;
// PKCE) with the redirect address https://claude.ai/api/mcp/auth_callback plus any extras,
// records it in public.connector_clients, and prints its client id (nothing secret). If an app
// with that name is already recorded it prints that id and changes nothing. Removing deletes
// the OAuth client and its connector_clients row; the database refuses the app's tokens at once.
//
// It writes to whichever project the environment points at, so for anything but
// 127.0.0.1/localhost it prints the host and waits for you to type it back before it sends
// anything there.
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const USAGE = 'Usage: pnpm connector:register "<name>" [extra redirect address…]\n       pnpm connector:register --remove <client_id>';

function stop(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) stop("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (in .env.local for `pnpm connector:register`).");

let host;
try {
  host = new URL(url).hostname;
} catch {
  stop("NEXT_PUBLIC_SUPABASE_URL is not a valid address.");
}

const args = process.argv.slice(2);
const removing = args[0] === "--remove";
if (removing && (args.length !== 2 || !args[1].trim())) stop(USAGE);
if (!removing && (args.length < 1 || !args[0].trim() || args[0].startsWith("--"))) stop(USAGE);

const name = removing ? "" : args[0].trim();
const extras = removing ? [] : args.slice(1);
for (const address of extras) {
  let parsed;
  try {
    parsed = new URL(address);
  } catch {
    stop(`Not a valid redirect address: ${address}`);
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    stop(`A redirect address must be https (or http on 127.0.0.1/localhost): ${address}`);
  }
}
const redirects = [...new Set([CLAUDE_REDIRECT, ...extras])];

// Confirmation before anything is sent to a project that is not on this machine.
async function confirmHost() {
  if (host === "127.0.0.1" || host === "localhost") return;
  console.log(`This will ${removing ? "remove an app from" : "register an app with"} the Supabase project at: ${host}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  // stdin closing without an answer (nothing typed) is a "no".
  const closed = new Promise((resolve) => prompt.once("close", () => resolve(null)));
  const typed = await Promise.race([prompt.question("Type the host above to continue: "), closed]);
  prompt.close();
  if (typeof typed !== "string" || typed.trim() !== host) stop("Not confirmed; nothing was changed.");
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

/** Deletes an OAuth client this run just made; says so honestly if that fails. */
async function undoCreate(clientId, why) {
  const undone = await admin.auth.admin.oauth.deleteClient(clientId);
  if (undone.error) {
    stop(`${why} Deleting the new OAuth client again also failed (${undone.error.message}), so it still exists but is not on the list ` +
      `(the database refuses its tokens). Remove it with: pnpm connector:register --remove ${clientId}`);
  }
  stop(`${why} The new OAuth client was deleted again.`);
}

async function remove(clientId) {
  const existing = await admin.auth.admin.oauth.getClient(clientId);
  // Only "not found" means there is no OAuth client; any other failure stops before changing anything.
  const noOAuthClient = Boolean(existing.error) && (existing.error.status === 404 || existing.error.status === 400);
  if (existing.error && !noOAuthClient) stop(`Could not look up the OAuth client: ${existing.error.message}`);
  const row = await admin.from("connector_clients").select("client_id").eq("client_id", clientId).maybeSingle();
  if (row.error) stop(`Could not read connector_clients: ${row.error.message}`);
  if (noOAuthClient && !row.data) stop(`No app with client id ${clientId} is registered here.`);
  // The row first: once it is gone the database refuses the app's tokens, even if the next step fails.
  const deletedRow = await admin.from("connector_clients").delete().eq("client_id", clientId);
  if (deletedRow.error) stop(`Could not delete the connector_clients row: ${deletedRow.error.message}`);
  if (!noOAuthClient) {
    const deleted = await admin.auth.admin.oauth.deleteClient(clientId);
    if (deleted.error) stop(`The row is gone (its tokens are refused), but deleting the OAuth client failed: ${deleted.error.message}`);
  }
  console.log(`Removed app ${clientId}.`);
}

async function register() {
  const known = await admin.from("connector_clients").select("client_id").eq("name", name).limit(1);
  if (known.error) stop(`Could not read connector_clients: ${known.error.message}`);
  if (known.data.length > 0) {
    console.log(`An app named "${name}" is already registered; nothing changed.`);
    console.log(`client id: ${known.data[0].client_id}`);
    return;
  }
  const created = await admin.auth.admin.oauth.createClient({
    client_name: name,
    redirect_uris: redirects,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  if (created.error || !created.data) stop(`Could not create the OAuth client: ${created.error?.message ?? "no client returned"}`);
  const client = created.data;
  if (client.client_type !== "public" || client.token_endpoint_auth_method !== "none") {
    await undoCreate(client.client_id, `Supabase made a ${client.client_type} client (auth method ${client.token_endpoint_auth_method}), not a public one.`);
  }
  const inserted = await admin.from("connector_clients").insert({ client_id: client.client_id, name });
  if (inserted.error) {
    // Never leave an OAuth client that is not on the list (it could not be used, but it should not exist).
    await undoCreate(client.client_id, `Could not record the app in connector_clients: ${inserted.error.message}.`);
  }
  console.log(`Registered "${name}" on ${host} (public client, PKCE, no secret).`);
  console.log(`redirect addresses: ${client.redirect_uris.join(", ")}`);
  console.log(`client id: ${client.client_id}`);
}

await confirmHost();
if (removing) await remove(args[1].trim());
else await register();
