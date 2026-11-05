/** Explicit synthetic fixture opt-in; only the controller-provisioned PG17
 * disposable container is accepted. No application secrets or server resets. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const container = process.env.MULTI_WALLET_TEST_DOCKER_CONTAINER;
const database = process.env.MULTI_WALLET_TEST_DATABASE;
if (process.env.MULTI_WALLET_TEST_ALLOW_FIXTURES !== "1"
    || container !== "supabase_db_CODEX-BUDGET-MULTIWALLET-SYSTEM-20261105" || database !== "postgres") {
  throw new Error("Currency concurrency tests require the exact designated synthetic PG17 container/database and explicit fixture opt-in");
}
const args = ["exec", "-i", "-e", "PGPASSWORD=", "-e", "PGOPTIONS=", "-e", "PGPASSFILE=/tmp/budget-no-pgpass",
  container, "env", "-u", "PGSERVICE", "-u", "PGSERVICEFILE", "psql", "-XqAt", "--no-password", "-U", "postgres",
  "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const owner = randomUUID();
const active = new Set();
const claims = `set local role authenticated; select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);`;

function session() {
  const child = spawn("docker", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  active.add(child);
  let output = "", errors = "", closed = false;
  const markers = new Map();
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => child.kill(), 20000);
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
  return {
    send(sql) { child.stdin.write(`${sql}\n`); },
    wait(token) {
      if (output.includes(token)) return Promise.resolve();
      if (closed) return Promise.reject(new Error(errors || "Session ended before barrier"));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { markers.delete(token); reject(new Error(`Missing database barrier: ${token}`)); }, 12000);
        markers.set(token, { resolve: () => { clearTimeout(timeout); resolve(); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
      });
    },
    end(sql = "") { child.stdin.end(sql); return completed; },
  };
}
async function sql(statement) {
  const run = session(); run.send(statement);
  const result = await run.end();
  assert.equal(result.code, 0, result.errors);
  return result.output.trim();
}
const owned = (statement) => sql(`begin; ${claims} ${statement} commit;`);
let created = false;
let passed = 0;
const scalar = async (statement) => (await owned(statement)).split(/\r?\n/).at(-1);
async function wallet(name, currency = "USD") {
  const id = await scalar(`select public.create_wallet('${name}','cash','${currency}',0);`);
  const balance = await scalar(`select default_balance_id from public.wallets where id='${id}';`);
  return { id, balance };
}
// The contender first proves the exact row lock is held. It then attempts the
// real mutation; a backend lock-wait barrier confirms it blocks before commit.
async function race(label, firstSQL, probe, secondSQL, expectedError) {
  const first = session(), second = session();
  const application = `multi-wallet-${randomUUID()}`;
  first.send(`begin; ${claims} ${firstSQL} select 'FIRST_READY';`);
  await first.wait("FIRST_READY");
  second.send(`set application_name='${application}'; begin; ${claims}
    do $$ begin begin ${probe}; raise exception 'missing conflicting lock';
      exception when lock_not_available then null; end; end $$;
    select 'LOCK_CONFIRMED'; ${secondSQL} commit;`);
  try { await second.wait("LOCK_CONFIRMED"); }
  catch (error) { await first.end("rollback;\n"); await second.end(); throw error; }
  first.send(`reset role; do $$ declare deadline timestamptz:=clock_timestamp()+interval '8 seconds'; begin loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event_type='Lock') then exit; end if;
    if clock_timestamp()>deadline then raise exception 'contender did not wait on the lock'; end if;
    perform pg_sleep(0.005);
  end loop; end $$; select 'CONTENDER_WAITING';`);
  try { await first.wait("CONTENDER_WAITING"); }
  catch (error) { await first.end("rollback;\n"); await second.end(); throw error; }
  const a = await first.end("commit;\n"), b = await second.end();
  assert.equal(a.code, 0, a.errors);
  if (expectedError) { assert.notEqual(b.code, 0); assert.match(b.errors, expectedError); }
  else assert.equal(b.code, 0, b.errors);
  console.log(`PASS ${label}: conflicting row lock, observed wait, validated outcome`); passed++;
}
try {
  const version = Number(await sql("select current_setting('server_version_num');"));
  assert.ok(version >= 170000 && version < 180000, "PostgreSQL 17 required");
  await sql(`insert into auth.users(id,instance_id,aud,role,email) values('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@multiwallet.example.test');`);
  created = true;
  const a = await wallet("Synthetic A"), b = await wallet("Synthetic B");
  // This is deliberately first: before the final lock-ordering implementation,
  // reorder held no owner lock, giving a genuine deterministic RED.
  await race("reorder versus create", `select public.reorder_wallets(array['${b.id}','${a.id}']::uuid[]);`,
    `perform 1 from public.profiles where user_id='${owner}' for update nowait`,
    "select public.create_wallet('Synthetic appended','cash','USD',0);", null);
  assert.equal(await scalar("select count(*)=count(distinct position) and min(position)=0 and max(position)=count(*)-1 from public.wallets where deleted_at is null;"), "t");
  for (const operation of ["edit", "delete"]) {
    const code = operation === "edit" ? "EDITCOIN" : "DELETECOIN";
    await owned(`insert into public.currencies(code,symbol,decimal_places) values('${code}','T',4);`);
    await race(`first currency use versus ${operation}`, `select public.add_wallet_balance('${a.id}','${code}');`,
      `perform 1 from public.currencies where user_id='${owner}' and code='${code}' for update nowait`,
      operation === "edit" ? `update public.currencies set decimal_places=5 where code='${code}';` : `delete from public.currencies where code='${code}';`, /currency.used/);
  }
  const disabled = await scalar(`select id from public.wallet_balances where wallet_id='${a.id}' and currency='EDITCOIN';`);
  const income = await scalar("select id from public.categories where kind='income' and parent_id is null order by position limit 1;");
  await race("disable versus new money", "select public.set_currency_disabled('EDITCOIN',true);",
    `perform 1 from public.currencies where user_id='${owner}' and code='EDITCOIN' for update nowait`,
    `insert into public.transactions(kind,occurred_on,balance_id,amount_minor,currency,category_id) values('income','2026-11-05','${disabled}',1,'EDITCOIN','${income}');`, /currency.disabled/);
  const lbp = await scalar(`select public.add_wallet_balance('${b.id}','LBP');`);
  await race("transfer versus detach", `select public.record_balance_transfer('2026-11-05','${a.balance}','${lbp}',1,1000);`,
    `perform 1 from public.wallet_balances where id='${lbp}' for update nowait`,
    `select public.detach_wallet_balance('${lbp}');`, /balance.nonzero/);
  assert.equal(await scalar(`select balance_minor from public.wallet_balance_totals where balance_id='${lbp}';`), "1000");
  const zero = await wallet("Synthetic zero");
  const category = await scalar("select id from public.categories where kind='expense' and parent_id is null order by position limit 1;");
  await race("new reference versus tombstone", `insert into public.fixed_expenses(name,amount_minor,balance_id,category_id) values('Synthetic reference',1,'${zero.balance}','${category}');`,
    `perform 1 from public.wallets where id='${zero.id}' for update nowait`, `select public.delete_wallet('${zero.id}');`, /wallet.inUse/);
  const syp = await scalar(`select public.add_wallet_balance('${zero.id}','SYP');`);
  await race("default versus detach", `select public.set_wallet_default('${zero.id}','${syp}');`,
    `perform 1 from public.wallets where id='${zero.id}' for update nowait`, `select public.detach_wallet_balance('${syp}');`, /wallet.invalidDefault/);
  const removable = await wallet("Synthetic removable");
  await race("reorder versus delete", "select public.reorder_wallets((select array_agg(id order by position desc) from public.wallets where deleted_at is null));",
    `perform 1 from public.profiles where user_id='${owner}' for update nowait`, `select public.delete_wallet('${removable.id}');`, null);
  assert.equal(await scalar("select count(*)=count(distinct position) and min(position)=0 and max(position)=count(*)-1 from public.wallets where deleted_at is null;"), "t");
  console.log(`PASS ${passed}/8 deterministic multi-wallet concurrency cases.`);
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally {
  await Promise.all([...active].map((child) => new Promise((resolve) => { child.once("close", resolve); child.kill(); })));
  if (created) { try { await sql(`delete from auth.users where id='${owner}';`); } catch (error) { console.error(`Synthetic cleanup failed: ${error.message}`); process.exitCode=1; } }
}
