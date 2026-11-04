/**
 * Explicit opt-in, synthetic two-connection checks against the designated PG17
 * disposable database only. Never starts/resets a server or reads app secrets.
 * CURRENCY_TEST_ALLOW_FIXTURES=1, CURRENCY_TEST_DOCKER_CONTAINER=
 * supabase_db_budget-tracker-round3-check, CURRENCY_TEST_DATABASE=round3_check_17
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const container = process.env.CURRENCY_TEST_DOCKER_CONTAINER;
const database = process.env.CURRENCY_TEST_DATABASE;
if (process.env.CURRENCY_TEST_ALLOW_FIXTURES !== "1"
    || container !== "supabase_db_budget-tracker-round3-check" || !/^round3_check_\d+$/.test(database ?? "")) {
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
let category;

function reference(kind, wallet, id, mode = "insert") {
  if (kind === "salary") return `update public.profiles set salary_amount_minor=1250,salary_wallet_id='${wallet}' where user_id='${owner}';`;
  if (mode === "move") return `update public.${kind} set wallet_id='${wallet}' where id='${id}';`;
  if (kind === "fixed_expenses") return `insert into public.fixed_expenses(id,name,amount_minor,wallet_id,category_id)
    values('${id}','Synthetic fixed concurrency',1250,'${wallet}','${category}');`;
  return `insert into public.installments(id,name,total_minor,monthly_minor,wallet_id,category_id,currency)
    values('${id}','Synthetic installment concurrency',10000,1250,'${wallet}','${category}','USD');`;
}
async function makeWallet() {
  const wallet = randomUUID();
  await owned(`insert into public.wallets(id,name,kind,currency) values('${wallet}','Synthetic currency concurrency','cash','SYP');`);
  return wallet;
}

try {
  const serverVersion = Number(await sql("select current_setting('server_version_num');"));
  assert.ok(serverVersion >= 170000 && serverVersion < 180000, "currency concurrency regression targets PostgreSQL 17");
  await sql(`insert into auth.users(id,instance_id,aud,role,email) values('${owner}',
    '00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@currency.example.test');`);
  created = true;
  category = (await owned(`select id from public.categories where kind='expense' and parent_id is null order by position limit 1;`))
    .split(/\r?\n/).find((line) => /^[a-f0-9-]{36}$/.test(line));
  assert.ok(category);

  for (const kind of ["installments", "fixed_expenses", "salary"]) for (const mode of ["insert", "move"]) {
    const wallet = await makeWallet();
    const id = randomUUID();
    if (mode === "move") await owned(reference(kind, await makeWallet(), id));
    else if (kind === "salary") await owned(`update public.profiles set salary_wallet_id=null,salary_amount_minor=null where user_id='${owner}';`);
    const writer = session();
    writer.send(`begin; ${claims} ${reference(kind, wallet, id, mode)} select 'REFERENCE_READY';`);
    await writer.wait("REFERENCE_READY");
    const editor = session();
    editor.send(`begin; ${claims}
      do $$ begin
        begin
          perform 1 from public.wallets where id='${wallet}' for no key update nowait;
          raise exception 'missing conflicting wallet reference lock';
        exception when lock_not_available then null; end;
      end $$;
      select 'REFERENCE_LOCK_CONFIRMED';
      update public.wallets set currency='USD' where id='${wallet}'; commit;`);
    try { await editor.wait("REFERENCE_LOCK_CONFIRMED"); }
    catch (error) { await writer.end("rollback;\n"); await editor.end(); throw error; }
    const first = await writer.end("commit;\n");
    const second = await editor.end();
    assert.equal(first.code, 0, first.errors);
    assert.notEqual(second.code, 0, "referenced wallet edit must be rejected after the writer commits");
    assert.match(second.errors, /wallet currency cannot change/);
    assert.equal((await owned(`select currency::text from public.wallets where id='${wallet}';`)).split(/\r?\n/).at(-1), "SYP");
    console.log(`PASS reference-first ${kind} ${mode}: conflicting lock, rejected edit, SYP unchanged`);
    passed++;
  }

  for (const kind of ["installments", "fixed_expenses", "salary"]) {
    const wallet = await makeWallet();
    const id = randomUUID();
    const application = `currency-reference-${randomUUID()}`;
    const editor = session();
    editor.send(`begin; ${claims} update public.wallets set currency='USD' where id='${wallet}'; select 'CURRENCY_READY';`);
    await editor.wait("CURRENCY_READY");
    const writer = session();
    writer.send(`set application_name='${application}'; begin; ${claims} select 'WRITER_READY'; ${reference(kind, wallet, id)} commit;`);
    await writer.wait("WRITER_READY");
    // Query the second connection's lock wait from the first connection. This
    // observes the actual blocking INSERT/UPDATE, not a timing-based sleep.
    // Only the lock observer resumes the synthetic test administrator role;
    // otherwise pg_stat_activity hides another backend's wait_event from auth.
    editor.send(`reset role; do $$ declare deadline timestamptz := clock_timestamp()+interval '8 seconds'; waiting boolean;
      begin loop
        select wait_event_type='Lock' into waiting from pg_stat_activity where application_name='${application}';
        if waiting then exit; end if;
        if not exists(select 1 from pg_stat_activity where application_name='${application}')
           or exists(select 1 from pg_stat_activity where application_name='${application}' and state='idle' and query ~* '^commit') then
          raise exception 'reference writer did not wait for the currency edit';
        end if;
        if clock_timestamp()>deadline then raise exception 'currency reference wait barrier timed out'; end if;
        perform pg_sleep(0.005);
        perform pg_stat_clear_snapshot();
      end loop; end $$; select 'REFERENCE_WAITING';`);
    try { await editor.wait("REFERENCE_WAITING"); }
    catch (error) { await editor.end("rollback;\n"); await writer.end(); throw error; }
    const first = await editor.end("commit;\n");
    const second = await writer.end();
    assert.equal(first.code, 0, first.errors);
    assert.equal(second.code, 0, second.errors);
    const state = await owned(kind === "installments"
      ? `select i.currency::text||'|'||w.currency::text from public.installments i join public.wallets w on w.id=i.wallet_id where i.id='${id}';`
      : kind === "salary" ? `select w.currency::text from public.profiles p join public.wallets w on w.id=p.salary_wallet_id where p.user_id='${owner}';`
        : `select w.currency::text from public.fixed_expenses f join public.wallets w on w.id=f.wallet_id where f.id='${id}';`);
    assert.equal(state.split(/\r?\n/).at(-1), kind === "installments" ? "USD|USD" : "USD");
    console.log(`PASS currency-first ${kind}: writer waits and reads committed USD currency`);
    passed++;
  }
  console.log(`PASS: ${passed}/9 wallet currency/reference concurrency cases on the designated PG17 fixture.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  // Close outstanding transactions before deleting only this fresh synthetic user.
  await Promise.all([...active].map((child) => new Promise((resolve) => { child.once("close", resolve); child.kill(); })));
  if (created) {
    try { await sql(`delete from auth.users where id='${owner}';`); }
    catch { console.error("Synthetic currency fixture cleanup failed"); process.exitCode = 1; }
  }
}
