/**
 * Explicit opt-in two-connection regression for the designated disposable PG17
 * database. Never points at a remote database or reads application secrets.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const container = process.env.MULTI_CASH_TEST_DOCKER_CONTAINER;
const database = process.env.MULTI_CASH_TEST_DATABASE;
if (process.env.MULTI_CASH_TEST_ALLOW_FIXTURES !== "1"
    || container !== "supabase_db_budget-tracker-round3-check"
    || !/^round3_check_\d+$/.test(database ?? "")) {
  throw new Error("Multi-change concurrency requires the designated disposable PG17 container/database and explicit fixture opt-in");
}

const args = ["exec", "-i", "-e", "PGPASSWORD=", "-e", "PGOPTIONS=", "-e", "PGPASSFILE=/tmp/budget-no-pgpass",
  container, "env", "-u", "PGSERVICE", "-u", "PGSERVICEFILE", "psql", "-XqAt", "--no-password", "-U", "postgres",
  "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const runFile = promisify(execFile);
const owner = randomUUID();
const payer = randomUUID();
const usdChange = randomUUID();
const lbpChange = randomUUID();
const transaction = randomUUID();
const claims = `set local role authenticated; select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);`;
const active = new Set();

async function sql(statement) {
  const result = await runFile("docker", [...args, "--command", statement], { windowsHide: true, timeout: 30_000 });
  return result.stdout.trim();
}

function session() {
  const child = spawn("docker", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  active.add(child);
  let output = "", errors = "", closed = false;
  const markers = new Map();
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      active.delete(child); closed = true;
      for (const marker of markers.values()) marker.reject(new Error(errors || "Session closed before barrier"));
      resolve({ code, output, errors });
    });
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    for (const [token, marker] of markers) if (output.includes(token)) {
      marker.resolve(); markers.delete(token);
    }
  });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  child.stdin.on("error", () => {});
  return {
    send(statement) { child.stdin.write(`${statement}\n`); },
    wait(token) {
      if (output.includes(token)) return Promise.resolve();
      if (closed) return Promise.reject(new Error(errors || "Session ended before barrier"));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { markers.delete(token); reject(new Error(`Missing database barrier: ${token}`)); }, 12_000);
        markers.set(token, { resolve: () => { clearTimeout(timeout); resolve(); }, reject });
      });
    },
    end(statement = "") { child.stdin.end(statement); return completion; },
  };
}

let created = false;
try {
  const version = Number(await sql("select current_setting('server_version_num');"));
  assert.ok(version >= 170000 && version < 180000, "concurrency regression targets PostgreSQL 17");
  await sql(`insert into auth.users(id,instance_id,aud,role,email) values('${owner}',
    '00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@multi-change.example.test');`);
  created = true;
  const category = (await sql(`begin; ${claims}
    select id from public.categories where kind='expense' and parent_id is null order by position limit 1; commit;`))
    .split(/\r?\n/).find((line) => /^[a-f0-9-]{36}$/.test(line));
  assert.ok(category);
  await sql(`begin; ${claims}
    insert into public.wallets(id,name,kind,currency) values
      ('${payer}','Concurrency payer','cash','USD'),
      ('${usdChange}','Concurrency USD change','cash','USD'),
      ('${lbpChange}','Concurrency LBP change','cash','LBP');
    select * from public.save_transaction('${transaction}',null,
      '{"kind":"expense","occurredOn":"2026-11-05","walletId":"${payer}","amountMinor":1250,"categoryId":"${category}"}',null,
      '{"tenderMinor":2000,"changes":[{"walletId":"${usdChange}","amountMinor":500},{"walletId":"${lbpChange}","amountMinor":223750}]}');
    commit;`);
  const revision = Number((await sql(`begin; ${claims} select revision from public.transactions where id='${transaction}'; commit;`))
    .split(/\r?\n/).find((line) => /^\d+$/.test(line)));
  assert.ok(revision > 0);

  const editor = session();
  editor.send(`begin; ${claims}
    select * from public.save_transaction('${transaction}',${revision},
      '{"kind":"expense","occurredOn":"2026-11-05","walletId":"${payer}","amountMinor":1300,"categoryId":"${category}"}',null,
      '{"tenderMinor":2000,"changes":[{"walletId":"${usdChange}","amountMinor":400},{"walletId":"${lbpChange}","amountMinor":223750}]}');
    select 'EDIT_READY';`);
  await editor.wait("EDIT_READY");

  const currency = session();
  currency.send(`begin; ${claims}
    do $$ begin
      begin
        perform 1 from public.wallets where id='${lbpChange}' for no key update nowait;
        raise exception 'settlement edit did not lock receiver wallet';
      exception when lock_not_available then null; end;
    end $$;
    select 'CURRENCY_CONTENDED';
    update public.wallets set currency='SYP' where id='${lbpChange}'; commit;`);
  await currency.wait("CURRENCY_CONTENDED");
  const editResult = await editor.end("commit;\n");
  const currencyResult = await currency.end();
  assert.equal(editResult.code, 0, editResult.errors);
  assert.notEqual(currencyResult.code, 0, "referenced receiver currency update must fail after waiting");
  assert.match(currencyResult.errors, /wallet currency cannot change/);

  const result = await sql(`begin; ${claims}
    select amount_minor||'|'||tender_minor||'|'||change_wallet_ids::text from public.transactions where id='${transaction}';
    select string_agg(position||':'||currency::text||':'||amount_minor,',' order by position)
      from public.cashier_changes where transaction_id='${transaction}';
    select currency::text from public.wallets where id='${lbpChange}'; commit;`);
  const lines = result.split(/\r?\n/);
  assert.ok(lines.some((line) => line.startsWith(`1300|2000|{${usdChange},${lbpChange}}`)), "one winning parent snapshot remains");
  assert.ok(lines.includes("0:USD:400,1:LBP:223750"), "both winning child legs remain once and ordered");
  assert.equal(lines.at(-1), "LBP", "receiver currency remains locked to the saved leg");
  console.log("PASS: multi-leg replacement locks every receiver; concurrent currency edit fails without stale or duplicate legs.");
} finally {
  await Promise.all([...active].map((child) => new Promise((resolve) => { child.once("close", resolve); child.kill(); })));
  if (created) {
    try { await sql(`delete from auth.users where id='${owner}';`); }
    catch { console.error("Synthetic multi-change fixture cleanup failed"); process.exitCode = 1; }
  }
}
