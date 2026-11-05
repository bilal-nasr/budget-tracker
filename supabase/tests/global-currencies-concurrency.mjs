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
const claims = `set local role authenticated; select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true); select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);`;

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
  await sql(`insert into auth.users(id,instance_id,aud,role,email) values('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@global.example.test');`);
  created = true;
  const a=await wallet('A'), b=await wallet('B');
  const ownerProbe=`perform 1 from public.profiles where user_id='${owner}' for update nowait`;
  const coverage=async()=>assert.equal(await scalar(`select not exists(select 1 from public.wallets w cross join public.currencies c where w.user_id=c.user_id and w.deleted_at is null and c.disabled_at is null and not exists(select 1 from public.wallet_balances b where b.wallet_id=w.id and b.currency=c.code and b.detached_at is null));`),'t','every committed live wallet has complete enabled coverage');
  await race('disable versus wallet create', "select public.set_currency_disabled('LBP',true);", ownerProbe, "select public.create_wallet('During disable','cash','USD',0);",null);
  await coverage();
  await race('enable versus wallet create', "select public.set_currency_disabled('LBP',false);",ownerProbe,"select public.create_wallet('During enable','cash','USD',0);",null);
  await coverage();
  await race('currency add versus wallet create', "select public.create_currency('NEW','N',2);",ownerProbe,"select public.create_wallet('During add','cash','USD',0);",null);
  await coverage();
  await race('wallet create versus currency add', "select public.create_wallet('Before add','cash','USD',0);",ownerProbe,"select public.create_currency('NEXT','N',2);",null);
  await coverage();
  await race('currency add versus wallet delete', "select public.create_currency('DEL','D',2);",ownerProbe,`select public.delete_wallet('${b.id}');`,null);
  assert.equal(await scalar(`select count(*) from public.wallet_balances where wallet_id='${b.id}' and currency='DEL';`),'1');
  const doomed=await wallet('Already deleted');
  await race('wallet delete versus currency add', `select public.delete_wallet('${doomed.id}');`,ownerProbe,"select public.create_currency('AFTER','A',2);",null);
  assert.equal(await scalar(`select count(*) from public.wallet_balances where wallet_id='${doomed.id}' and currency='AFTER';`),'0');
  const income=await scalar("select id from public.categories where kind='income' and parent_id is null order by position limit 1;");
  await owned("select public.create_currency('FIRST','F',2);");
  const first=await scalar(`select id from public.wallet_balances where wallet_id='${a.id}' and currency='FIRST';`);
  const incomeSQL=(balance,code)=>`select set_config('request.headers',jsonb_build_object('x-budget-units',jsonb_build_object('${code}',2)::text)::text,true); insert into public.transactions(kind,occurred_on,balance_id,amount_minor,currency,category_id) values('income','2026-11-05','${balance}',1,'${code}','${income}');`;
  await race('first use versus currency delete',incomeSQL(first,'FIRST'),ownerProbe,"select public.delete_currency('FIRST');",/currency.used/);
  await owned("select public.create_currency('UNUSED','U',2);");
  const unused=await scalar(`select id from public.wallet_balances where wallet_id='${a.id}' and currency='UNUSED';`);
  await race('currency delete versus first use',"select public.delete_currency('UNUSED');",ownerProbe,incomeSQL(unused,'UNUSED'),/balance.unavailable|Wallet not found|wallet_not_found|wallet.notFound/);
  await owned("select public.create_currency('DISABLE','D',2);");
  const disabled=await scalar(`select id from public.wallet_balances where wallet_id='${a.id}' and currency='DISABLE';`);
  await race('disable versus new money',"select public.set_currency_disabled('DISABLE',true);",ownerProbe,incomeSQL(disabled,'DISABLE'),/currency.disabled/);
  await race('new money versus disable',incomeSQL(first,'FIRST'),ownerProbe,"select public.set_currency_disabled('FIRST',true);",/currency.nonzero/);
  const lbp=await scalar(`select id from public.wallet_balances where wallet_id='${a.id}' and currency='LBP';`);
  await race('default switch versus catalog disable',`select public.set_wallet_default('${a.id}','${lbp}');`,ownerProbe,"select public.set_currency_disabled('LBP',true);",null);
  assert.equal(await scalar(`select c.disabled_at is null from public.wallets w join public.wallet_balances b on b.id=w.default_balance_id join public.currencies c on(c.user_id,c.code)=(b.user_id,b.currency) where w.id='${a.id}';`),'t');
  await race('catalog disable versus default switch',"select public.set_currency_disabled('SYP',true);",ownerProbe,`select public.set_wallet_default('${a.id}',(select id from public.wallet_balances where wallet_id='${a.id}' and currency='SYP'));`,/currency.disabled/);
  await coverage();
  console.log(`PASS ${passed}/12 deterministic global-currency concurrency cases.`);
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally {
  await Promise.all([...active].map((child) => new Promise((resolve) => { child.once("close", resolve); child.kill(); })));
  if (created) { try { await sql(`delete from auth.users where id='${owner}';`); } catch (error) { console.error(`Synthetic cleanup failed: ${error.message}`); process.exitCode=1; } }
}
