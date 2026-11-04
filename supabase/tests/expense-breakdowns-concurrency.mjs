/**
 * Opt-in, local-only multi-session checks. Requires psql and an already migrated
 * disposable database. Never starts/resets a database or reads an env file.
 * BREAKDOWN_TEST_DATABASE_URL and BREAKDOWN_TEST_ALLOW_FIXTURES=1 are explicit
 * test settings. Fixtures use fresh UUIDs and are removed in finally.
 * Docker mode needs no host psql: BREAKDOWN_TEST_DOCKER_CONTAINER must be
 * supabase_db_budget-tracker-round3-check with BREAKDOWN_TEST_DATABASE=round3_check_17,
 * or budget_round3_sql_probe with BREAKDOWN_TEST_DATABASE=round3_check_2.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const connection = process.env.BREAKDOWN_TEST_DATABASE_URL;
const container = process.env.BREAKDOWN_TEST_DOCKER_CONTAINER;
const database = process.env.BREAKDOWN_TEST_DATABASE;
const allowedDockerTargets = new Map([
  ["supabase_db_budget-tracker-round3-check", /^round3_check_\d+$/],
  ["budget_round3_sql_probe", /^round3_check_\d+$/],
]);
if (process.env.BREAKDOWN_TEST_ALLOW_FIXTURES !== "1") {
  throw new Error("Set BREAKDOWN_TEST_ALLOW_FIXTURES=1 only for an already migrated disposable test database.");
}
if (container) {
  if (connection || !allowedDockerTargets.get(container)?.test(database ?? "")) {
    throw new Error("Docker mode accepts only designated disposable containers and round3_check_<number> databases, without a connection URL.");
  }
} else {
  if (!connection) throw new Error("Provide an explicit local test URL or a designated Docker test target.");
  const target = new URL(connection);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("Concurrency tests refuse non-loopback database connections.");
  }
}
const command = container ? "docker" : "psql";
const commonArgs = ["-X", "-qAt", "--no-password", "--dbname", container ? database : connection,
  "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose"];
const args = container ? ["exec", "-i", "-e", "PGPASSWORD=", "-e", "PGOPTIONS=",
  "-e", "PGPASSFILE=/tmp/budget-no-pgpass", container, "env", "-u", "PGSERVICE", "-u", "PGSERVICEFILE",
  "psql", "-U", "postgres", ...commonArgs] : commonArgs;
const childEnv = { ...process.env, PGPASSWORD: "", PGOPTIONS: "", PGPASSFILE: join(tmpdir(), "budget-no-pgpass") };
// An empty PGSERVICE still tells libpq to load a service file. Remove it rather
// than directing libpq at a nonexistent file or reading the user's settings.
delete childEnv.PGSERVICE;
delete childEnv.PGSERVICEFILE;
const runFile = promisify(execFile);
const owner = randomUUID();
const wallet = randomUUID();
const parent = randomUUID();
const claims = JSON.stringify({ sub: owner, role: "authenticated" });
const asOwner = `set local role authenticated; select set_config('request.jwt.claims','${claims}',true);`;
const safeError = (value) => connection ? String(value).replaceAll(connection, "<local test database>") : String(value);
const active = new Set();

async function sql(statement) {
  const result = await runFile(command, [...args, "--command", statement], { windowsHide: true, timeout: 30_000, env: childEnv });
  return result.stdout.trim();
}

function session() {
  const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: childEnv });
  active.add(child);
  let output = "";
  let errors = "";
  let closed = false;
  const listeners = new Map();
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      active.delete(child);
      closed = true;
      for (const pending of listeners.values()) pending.reject(new Error(`psql closed before barrier: ${safeError(errors)}`));
      resolve({ code, output, errors });
    });
  });
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    for (const [token, pending] of listeners) {
      if (output.includes(token)) {
        pending.resolve();
        listeners.delete(token);
      }
    }
  });
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  return {
    send: (statement) => child.stdin.write(`${statement}\n`),
    wait: (token) => {
      if (output.includes(token)) return Promise.resolve();
      if (closed) return Promise.reject(new Error(`psql already closed: ${safeError(errors)}`));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(token);
          reject(new Error(`Database barrier timed out: ${token}`));
        }, 15_000);
        listeners.set(token, {
          resolve: () => { clearTimeout(timeout); resolve(); },
          reject: (error) => { clearTimeout(timeout); reject(error); },
        });
      });
    },
    end: async () => { child.stdin.end(); return completion; },
  };
}

let fixtureCreated = false;
try {
  await sql(`begin;
    insert into auth.users(id,instance_id,aud,role,email) values
      ('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','breakdown-${owner}@example.test');
    ${asOwner}
    insert into public.wallets(id,name,kind,currency) values ('${wallet}','Concurrency fixture','cash','USD');
    commit;`);
  fixtureCreated = true;
  const category = (await sql(`begin; ${asOwner}
    select id from public.categories where kind='expense' and parent_id is null order by position limit 1; commit;`))
    .split(/\r?\n/).find((line) => /^[0-9a-f-]{36}$/.test(line));
  assert.ok(category, "fixture has an expense category");
  const input = JSON.stringify({ kind: "expense", occurredOn: "2026-11-04", walletId: wallet, amountMinor: 5000, categoryId: category, note: "Concurrency fixture" });
  const items = '[{"description":"Phone credits","amountMinor":2000}]';
  const save = (revision, amount = 5000, lines = items) =>
    `select id,revision from public.save_transaction('${parent}',${revision},'${input.replace('"amountMinor":5000', `"amountMinor":${amount}`)}','${lines}');`;

  // The first completed save stays uncommitted. The second session proves the
  // create advisory key is held before it tries the same create. No sleeps.
  const first = session();
  first.send(`begin; ${asOwner} ${save("null")} select 'FIRST_READY';`);
  await first.wait("FIRST_READY");
  const second = session();
  second.send(`begin; ${asOwner}
    do $$ begin
      if pg_try_advisory_xact_lock(hashtextextended('transaction-create:${parent}',0)) then
        raise exception 'create barrier was not held';
      end if;
    end $$;
    select 'CREATE_CONTENDED';
    ${save("null")} commit;`);
  await second.wait("CREATE_CONTENDED");
  first.send("commit;");
  const [firstResult, secondResult] = await Promise.all([first.end(), second.end()]);
  assert.equal(firstResult.code, 0, safeError(firstResult.errors));
  assert.equal(secondResult.code, 0, safeError(secondResult.errors));
  const firstMutation = firstResult.output.split(/\r?\n/).find((line) => line.startsWith(`${parent}|`));
  assert.ok(firstMutation);
  assert.ok(secondResult.output.includes(firstMutation), "same-ID concurrent replay returns identical ID/final revision");
  const savedRevision = Number(firstMutation.split("|")[1]);

  // A waiting stale replacement cannot erase the first writer's newer edit.
  const editor = session();
  editor.send(`begin; ${asOwner} ${save(savedRevision, 6000)} select 'EDIT_READY';`);
  await editor.wait("EDIT_READY");
  const stale = session();
  stale.send(`begin; ${asOwner}
    do $$ begin
      begin
        perform 1 from public.transactions where id='${parent}' for update nowait;
        raise exception 'parent barrier was not held';
      exception when lock_not_available then null; end;
    end $$;
    select 'EDIT_CONTENDED';
    ${save(savedRevision, 7000)} commit;`);
  await stale.wait("EDIT_CONTENDED");
  editor.send("commit;");
  const [editResult, staleResult] = await Promise.all([editor.end(), stale.end()]);
  assert.equal(editResult.code, 0, safeError(editResult.errors));
  assert.notEqual(staleResult.code, 0, "stale overlapping update must fail");
  assert.match(staleResult.errors, /BT003|transaction conflict/);

  // Two direct line writers cannot both consume the last 4000 of remainder.
  const fill = session();
  fill.send(`begin; ${asOwner}
    insert into public.expense_items(transaction_id,description,amount_minor,position)
      values ('${parent}','Remaining composition',4000,1);
    set constraints public.expense_items_valid,public.transactions_breakdown_valid immediate;
    select 'FILL_READY';`);
  await fill.wait("FILL_READY");
  const overfill = session();
  overfill.send(`begin; ${asOwner}
    do $$ begin
      begin
        perform 1 from public.transactions where id='${parent}' for update nowait;
        raise exception 'parent remainder barrier was not held';
      exception when lock_not_available then null; end;
    end $$;
    select 'FILL_CONTENDED';
    insert into public.expense_items(transaction_id,description,amount_minor,position)
      values ('${parent}','Would exceed composition',4000,2);
    set constraints public.expense_items_valid,public.transactions_breakdown_valid immediate;
    commit;`);
  await overfill.wait("FILL_CONTENDED");
  fill.send("commit;");
  const [fillResult, overfillResult] = await Promise.all([fill.end(), overfill.end()]);
  assert.equal(fillResult.code, 0, safeError(fillResult.errors));
  assert.notEqual(overfillResult.code, 0, "both direct item writers must not consume the same remainder");
  assert.match(overfillResult.errors, /BT001|breakdown exceeds total/);
  const result = await sql(`begin; ${asOwner}
    select count(*)||'|'||max(amount_minor) from public.transactions where id='${parent}';
    select balance_minor from public.wallet_balances where wallet_id='${wallet}';
    select count(*)||'|'||sum(amount_minor) from public.expense_items where transaction_id='${parent}'; commit;`);
  const lines = result.split(/\r?\n/);
  assert.ok(lines.includes("1|6000"), "one parent retains the winning cost");
  assert.ok(lines.includes("-6000"), "exactly one winning parent debit");
  assert.equal(lines.at(-1), "2|6000", "only one writer fills the last remainder");
  console.log("PASS: stable-ID create replay, revision-guarded edits and direct remainder races; one parent/debit.");
} catch (error) {
  // Do not print a connection string or credential-bearing child-process args.
  console.error(safeError(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  await Promise.all([...active].map((child) => new Promise((resolve) => {
    child.once("close", resolve);
    child.kill();
  })));
  if (fixtureCreated) {
    try { await sql(`delete from auth.users where id='${owner}';`); }
    catch { console.error("Fixture cleanup failed; remove the synthetic test account before reusing this disposable DB."); process.exitCode = 1; }
  }
}
