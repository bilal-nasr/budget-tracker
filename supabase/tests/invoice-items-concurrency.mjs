/**
 * Explicit opt-in multi-session regression for the invoice row id guard
 * (20261201000100_invoice_item_id_guard.sql). Runs psql inside an allowlisted local
 * Supabase database container only; never reads application secrets, never resets a
 * database, and removes its synthetic users (and everything they own) in finally.
 * INVOICE_ITEMS_TEST_ALLOW_FIXTURES=1
 * INVOICE_ITEMS_TEST_DOCKER_CONTAINER=supabase_db_BUDGET-TRACKER
 * INVOICE_ITEMS_TEST_DATABASE=postgres
 * Run: node supabase/tests/invoice-items-concurrency.mjs (after the migration is applied
 * locally, e.g. `supabase migration up`; `pnpm db:reset` wipes local data).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const container = process.env.INVOICE_ITEMS_TEST_DOCKER_CONTAINER;
const database = process.env.INVOICE_ITEMS_TEST_DATABASE;
const allowed = new Set(["supabase_db_BUDGET-TRACKER", "supabase_db_CODEX-BUDGET-MULTIWALLET-SYSTEM-20261105"]);
if (process.env.INVOICE_ITEMS_TEST_ALLOW_FIXTURES !== "1" || !allowed.has(container) || database !== "postgres") {
  throw new Error("Invoice item concurrency requires an allowlisted local Supabase database container and explicit fixture opt-in");
}

const args = ["exec", "-i", "-e", "PGPASSWORD=", "-e", "PGOPTIONS=", "-e", "PGPASSFILE=/tmp/budget-no-pgpass",
  container, "env", "-u", "PGSERVICE", "-u", "PGSERVICEFILE", "psql", "-XqAt", "--no-password", "-U", "postgres",
  "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const runFile = promisify(execFile);
const active = new Set();

// A owns the folders, B is a member of them, D is a stranger with a folder of their own.
const users = { a: randomUUID(), b: randomUUID(), d: randomUUID() };
const claims = (user) => `set local role authenticated; select set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);`;

async function sql(statement) {
  const result = await runFile("docker", [...args, "--command", statement], { windowsHide: true, timeout: 30_000 });
  return result.stdout.trim();
}
const lines = (output) => output.split(/\r?\n/);
const scalar = async (statement) => lines(await sql(statement)).at(-1);

function session(applicationName) {
  const child = spawn("docker", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  active.add(child);
  let output = "", errors = "", closed = false;
  const markers = new Map();
  const completion = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => child.kill(), 20_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout); active.delete(child); closed = true;
      for (const marker of markers.values()) marker.reject(new Error(errors || "Session closed before barrier"));
      resolve({ code, output, errors });
    });
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    for (const [token, marker] of markers) if (output.includes(token)) { marker.resolve(); markers.delete(token); }
  });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  child.stdin.on("error", () => {});
  if (applicationName) child.stdin.write(`set application_name='${applicationName}';\n`);
  return {
    send(statement) { child.stdin.write(`${statement}\n`); },
    wait(token) {
      if (output.includes(token)) return Promise.resolve();
      if (closed) return Promise.reject(new Error(errors || "Session ended before barrier"));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { markers.delete(token); reject(new Error(`Missing database barrier: ${token}`)); }, 12_000);
        markers.set(token, { resolve: () => { clearTimeout(timeout); resolve(); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
      });
    },
    end(statement = "") { child.stdin.end(statement); return completion; },
  };
}

/** Resolves once the session named applicationName is blocked on a heavyweight lock. */
async function waitForLock(applicationName) {
  await sql(`do $$ declare deadline timestamptz := clock_timestamp()+interval '8 seconds'; begin loop
      perform pg_stat_clear_snapshot();
      if exists(select 1 from pg_stat_activity where application_name='${applicationName}' and wait_event_type='Lock') then exit; end if;
      if clock_timestamp()>deadline then raise exception 'session % did not wait on a lock', '${applicationName}'; end if;
      perform pg_sleep(0.005);
    end loop; end $$;`);
}

/**
 * Resolves with "waiting" once the session is blocked on a heavyweight lock, or "gone" once
 * it has ended (psql stops at the first error, so a statement refused at once ends it).
 */
async function waitForLockOrExit(applicationName) {
  return scalar(`do $$ declare deadline timestamptz := clock_timestamp()+interval '8 seconds'; begin loop
      perform pg_stat_clear_snapshot();
      if exists(select 1 from pg_stat_activity where application_name='${applicationName}' and wait_event_type='Lock')
        or not exists(select 1 from pg_stat_activity where application_name='${applicationName}') then exit; end if;
      if clock_timestamp()>deadline then raise exception 'session % neither waited nor ended', '${applicationName}'; end if;
      perform pg_sleep(0.005);
    end loop; end $$;
    select case when exists(select 1 from pg_stat_activity where application_name='${applicationName}') then 'waiting' else 'gone' end;`);
}

/**
 * Runs one statement as `user` in its own transaction with a lock timeout, and returns the
 * psql result plus how long the statement took (ms). A statement that has to wait for
 * another open transaction fails with 55P03 instead of hanging; a deadlock shows as 40P01.
 */
async function timed(user, statement, { deadlockTimeout } = {}) {
  const run = session();
  run.send(`begin; ${deadlockTimeout ? `set local deadlock_timeout='${deadlockTimeout}';` : ""} set local lock_timeout='1500ms'; ${claims(user)}
    select set_config('invoice_test.t0', clock_timestamp()::text, true);
    ${statement}
    select 'ELAPSED_MS:'||round(extract(epoch from clock_timestamp()-current_setting('invoice_test.t0')::timestamptz)*1000);
    commit;`);
  const result = await run.end();
  const match = result.output.match(/ELAPSED_MS:(\d+)/);
  return { ...result, elapsed: match ? Number(match[1]) : null };
}

const item = (id, folder, name = "Row") =>
  `insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor) values ('${id}','${folder}','${name}','USD',2,100)`;
async function folder(owner, name, memberB = true) {
  const id = randomUUID();
  await sql(`begin; ${claims(owner)} insert into public.invoice_folders(id, name) values ('${id}','${name}'); commit;`);
  if (memberB) await sql(`insert into public.invoice_members(folder_id, user_id, display_name) values ('${id}','${users.b}','Bob');`);
  return id;
}
async function addRow(owner, folderId, name) {
  const id = randomUUID();
  await sql(`begin; ${claims(owner)} ${item(id, folderId, name)}; commit;`);
  return id;
}
const rowFolder = (id) => scalar(`select coalesce((select folder_id::text from public.invoice_items where id='${id}'),'none');`);
const tombstone = (id) => scalar(`select coalesce((select folder_id::text||'|'||coalesce(restoring_txid::text,'') from public.invoice_item_tombstones where id='${id}'),'none');`);

let passed = 0;
const pass = (label) => { console.log(`PASS ${label}`); passed++; };

/**
 * (a) A delete of X is still uncommitted when a stranger inserts X into their own folder.
 * The insert must wait for the delete, and once it commits be refused (42501): the id
 * belongs to the new tombstone. The tombstone stays in the original folder; Undo works.
 */
async function inFlightDelete(label, folderA, folderD, onConflict) {
  const x = await addRow(users.a, folderA, `In flight ${label}`);
  const deleter = session();
  deleter.send(`begin; ${claims(users.b)} delete from public.invoice_items where id='${x}'; select 'DELETED';`);
  await deleter.wait("DELETED");
  const app = `invoice-squat-${randomUUID()}`;
  const squatter = session(app);
  squatter.send(`begin; ${claims(users.d)} select 'STARTED'; ${item(x, folderD, "Squat")} ${onConflict ? "on conflict (id) do nothing" : ""}; commit;`);
  await squatter.wait("STARTED");
  try { await waitForLock(app); }
  catch (error) { await deleter.end("rollback;\n"); await squatter.end(); throw error; }
  const first = await deleter.end("commit;\n");
  const second = await squatter.end();
  assert.equal(first.code, 0, first.errors);
  assert.notEqual(second.code, 0, `${label}: the squat must be refused`);
  assert.match(second.errors, /42501: invoices\.invalid/, second.errors);
  assert.equal(await rowFolder(x), "none", `${label}: no row took the id`);
  assert.equal(await tombstone(x), `${folderA}|`, `${label}: the tombstone stays in the original folder, unmarked`);
  const restore = await sql(`begin; ${claims(users.b)} select public.restore_invoice_item('${x}'); commit;`).then(() => "ok", (error) => String(error.stderr ?? error));
  assert.equal(restore, "ok", restore);
  assert.equal(await scalar(`select folder_id||'|'||created_by from public.invoice_items where id='${x}';`), `${folderA}|${users.a}`, `${label}: Undo brings the row back to its folder and author`);
  pass(`(a) ${label}: insert waited for the in-flight delete, was refused with 42501, and Undo still works`);
}

/** (a) If the in-flight delete rolls back instead, the retried insert is the usual duplicate no-op. */
async function inFlightDeleteRolledBack(folderA, folderD) {
  const x = await addRow(users.a, folderA, "Rolled back");
  const deleter = session();
  deleter.send(`begin; ${claims(users.b)} delete from public.invoice_items where id='${x}'; select 'DELETED';`);
  await deleter.wait("DELETED");
  const app = `invoice-squat-${randomUUID()}`;
  const squatter = session(app);
  squatter.send(`begin; ${claims(users.d)} select 'STARTED'; ${item(x, folderD, "Squat")} on conflict (id) do nothing; commit;`);
  await squatter.wait("STARTED");
  try { await waitForLock(app); }
  catch (error) { await deleter.end("rollback;\n"); await squatter.end(); throw error; }
  const first = await deleter.end("rollback;\n");
  const second = await squatter.end();
  assert.equal(first.code, 0, first.errors);
  assert.equal(second.code, 0, second.errors);
  assert.equal(await rowFolder(x), folderA, "the row stays where it was");
  assert.equal(await tombstone(x), "none", "a rolled-back delete leaves no tombstone");
  pass("(a) rolled-back delete: the waiting insert ignores the live duplicate and changes nothing");
}

/**
 * (b) A retried add (ON CONFLICT DO NOTHING) of live row X into folder F is in flight,
 * blocked on F, while the owner deletes F. The owner's delete must not wait for the retry
 * (the cascade deletes X) and must not deadlock. The retrier's own deadlock check is pushed
 * out so that, with a cycle, the owner's delete is the one that reports it.
 */
async function retryVersusFolderDelete() {
  const folderB = await folder(users.a, "Deleted while retried");
  const x = await addRow(users.a, folderB, "Live");
  const owner = session();
  owner.send(`begin; set local deadlock_timeout='200ms'; set local lock_timeout='1500ms'; ${claims(users.a)}
    select 1 from public.invoice_folders where id='${folderB}' for no key update; select 'FOLDER_HELD';`);
  await owner.wait("FOLDER_HELD");
  const app = `invoice-retry-${randomUUID()}`;
  const retry = session(app);
  retry.send(`begin; set local deadlock_timeout='10s'; ${claims(users.b)} select 'STARTED'; ${item(x, folderB, "Live")} on conflict (id) do nothing; commit;`);
  await retry.wait("STARTED");
  try { await waitForLock(app); }
  catch (error) { await owner.end("rollback;\n"); await retry.end(); throw error; }
  owner.send(`select set_config('invoice_test.t0', clock_timestamp()::text, true);
    delete from public.invoice_folders where id='${folderB}';
    select 'ELAPSED_MS:'||round(extract(epoch from clock_timestamp()-current_setting('invoice_test.t0')::timestamptz)*1000);`);
  const first = await owner.end("commit;\n");
  const second = await retry.end();
  assert.doesNotMatch(first.errors, /40P01/, `the owner's folder delete deadlocked: ${first.errors}`);
  assert.equal(first.code, 0, first.errors);
  const elapsed = Number(first.output.match(/ELAPSED_MS:(\d+)/)?.[1]);
  assert.ok(elapsed < 1000, `the owner's folder delete took ${elapsed} ms`);
  assert.doesNotMatch(second.errors, /40P01/, second.errors);
  // The folder is gone by the time the retry runs, so its insert fails the folder reference.
  assert.notEqual(second.code, 0);
  assert.match(second.errors, /23503/, second.errors);
  assert.equal(await scalar(`select count(*) from public.invoice_folders where id='${folderB}';`), "0");
  assert.equal(await rowFolder(x), "none");
  assert.equal(await scalar(`select count(*) from public.invoice_item_tombstones where folder_id='${folderB}' or id='${x}';`), "0");
  pass(`(b) retried add vs folder delete: the owner's delete finished in ${elapsed} ms with no deadlock; the retry failed cleanly (23503)`);
}

/**
 * (c) A stranger's insert of a live id X (in another tenant's folder) is in flight, blocked on
 * the stranger's own folder. The owner's delete of X must not wait for it. Once the delete has
 * committed, the stranger's insert finds X's open Undo and is refused.
 */
async function strangerBlockedVersusRowDelete(folderA, folderD) {
  const x = await addRow(users.a, folderA, "Victim");
  const holder = session();
  holder.send(`begin; ${claims(users.d)} ${item(randomUUID(), folderD, "Holder")}; select 'FOLDER_HELD';`);
  await holder.wait("FOLDER_HELD");
  const app = `invoice-stranger-${randomUUID()}`;
  const stranger = session(app);
  stranger.send(`begin; ${claims(users.d)} select 'STARTED'; ${item(x, folderD, "Squat")} on conflict (id) do nothing; commit;`);
  await stranger.wait("STARTED");
  try { await waitForLock(app); }
  catch (error) { await holder.end("rollback;\n"); await stranger.end(); throw error; }
  let removal;
  try { removal = await timed(users.a, `delete from public.invoice_items where id='${x}';`); }
  finally { await holder.end("rollback;\n"); }
  const second = await stranger.end();
  assert.equal(removal.code, 0, `the owner's delete waited for the stranger: ${removal.errors}`);
  assert.ok(removal.elapsed < 1000, `the owner's delete took ${removal.elapsed} ms`);
  assert.equal(await tombstone(x), `${folderA}|`);
  assert.notEqual(second.code, 0, "the stranger's insert must be refused once the Undo is open");
  assert.match(second.errors, /42501: invoices\.invalid/, second.errors);
  assert.equal(await rowFolder(x), "none");
  pass(`(c) stranger blocked mid-insert: the owner's row delete finished in ${removal.elapsed} ms; the late insert was refused with 42501`);
}

/** (c) A stranger idling in a transaction after inserting a live id holds nothing on that row. */
async function strangerIdleVersusRowDelete(folderA, folderD) {
  const x = await addRow(users.a, folderA, "Victim idle");
  const stranger = session();
  stranger.send(`begin; ${claims(users.d)} ${item(x, folderD, "Squat")} on conflict (id) do nothing; select 'HELD';`);
  await stranger.wait("HELD");
  let removal;
  try { removal = await timed(users.a, `delete from public.invoice_items where id='${x}';`); }
  finally { await stranger.end("rollback;\n"); }
  assert.equal(removal.code, 0, `the owner's delete waited for the stranger: ${removal.errors}`);
  assert.ok(removal.elapsed < 1000, `the owner's delete took ${removal.elapsed} ms`);
  assert.equal(await tombstone(x), `${folderA}|`);
  pass(`(c) stranger idle after a no-op insert: the owner's row delete finished in ${removal.elapsed} ms`);
}

/**
 * (d) X was deleted (committed) and its Undo is open. A stranger who saw X sends a two-row
 * insert [(X, own folder), (W, own second folder)] whose second row blocks on the second
 * folder, held by the stranger's own other transaction. The squatted X must never reach the
 * primary key index (it is refused before it is written), so the victim's Undo does not wait
 * on the stranger's transaction. With the check refusing before the write, the stranger's
 * statement ends at once on its first row; without it, it sits blocked on the second row
 * with X already in the index.
 */
async function bulkSquatVersusRestore(folderA, folderD, folderD2) {
  const x = await addRow(users.a, folderA, "Undo target");
  await sql(`begin; ${claims(users.b)} delete from public.invoice_items where id='${x}'; commit;`);
  const holder = session();
  holder.send(`begin; ${claims(users.d)} select 1 from public.invoice_folders where id='${folderD2}' for no key update; select 'FOLDER_HELD';`);
  await holder.wait("FOLDER_HELD");
  const app = `invoice-bulk-${randomUUID()}`;
  const stranger = session(app);
  stranger.send(`begin; ${claims(users.d)} select 'STARTED';
    insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
      values ('${x}','${folderD}','Squat','USD',2,100), ('${randomUUID()}','${folderD2}','Cover','USD',2,100);
    commit;`);
  await stranger.wait("STARTED");
  let state, undo;
  try {
    state = await waitForLockOrExit(app);
    undo = await timed(users.b, `select public.restore_invoice_item('${x}');`);
  } finally { await holder.end("rollback;\n"); }
  const second = await stranger.end();
  assert.equal(undo.code, 0, `the victim's Undo waited on the stranger's insert (stranger was ${state}): ${undo.errors}`);
  assert.ok(undo.elapsed < 1000, `the victim's Undo took ${undo.elapsed} ms`);
  assert.equal(await scalar(`select folder_id||'|'||created_by from public.invoice_items where id='${x}';`), `${folderA}|${users.a}`, "Undo brings the row back");
  assert.notEqual(second.code, 0, "the stranger's bulk insert must be refused");
  assert.match(second.errors, /42501: invoices\.invalid/, second.errors);
  pass(`(d) bulk squat with a blocked second row: the victim's Undo finished in ${undo.elapsed} ms (stranger ${state}); the squat was refused with 42501`);
}

let created = false;
const failures = [];
try {
  const version = Number(await sql("select current_setting('server_version_num');"));
  assert.ok(version >= 170000 && version < 180000, "invoice item concurrency targets PostgreSQL 17");
  await sql(`insert into auth.users(id,instance_id,aud,role,email) values
    ('${users.a}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${users.a}@invoice-items.example.test'),
    ('${users.b}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${users.b}@invoice-items.example.test'),
    ('${users.d}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${users.d}@invoice-items.example.test');`);
  created = true;
  const folderA = await folder(users.a, "Shared");
  const folderD = await folder(users.d, "Stranger", false);
  const folderD2 = await folder(users.d, "Stranger 2", false);
  // Each case runs even if an earlier one failed, so one run shows every regression.
  for (const run of [
    () => inFlightDelete("plain insert", folderA, folderD, false),
    () => inFlightDelete("insert ignoring duplicates", folderA, folderD, true),
    () => inFlightDeleteRolledBack(folderA, folderD),
    () => retryVersusFolderDelete(),
    () => strangerBlockedVersusRowDelete(folderA, folderD),
    () => strangerIdleVersusRowDelete(folderA, folderD),
    () => bulkSquatVersusRestore(folderA, folderD, folderD2),
  ]) {
    try { await run(); }
    catch (error) { failures.push(error); console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`); }
  }
  console.log(`${passed}/7 invoice item concurrency cases passed.`);
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally {
  await Promise.all([...active].map((child) => new Promise((resolve) => { child.once("close", resolve); child.kill(); })));
  if (created) {
    try {
      // Deleting the accounts deletes their folders, rows, memberships and the folders' tombstones.
      await sql(`delete from auth.users where id in ('${users.a}','${users.b}','${users.d}');`);
      const left = await scalar(`select (select count(*) from public.invoice_folders where owner_id in ('${users.a}','${users.d}'))
        + (select count(*) from public.invoice_item_tombstones where deleted_by in ('${users.a}','${users.b}','${users.d}'));`);
      assert.equal(left, "0", "synthetic fixtures left behind");
    } catch (error) { console.error(`Synthetic cleanup failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
  }
}
