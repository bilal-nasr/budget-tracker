/**
 * Explicit opt-in, disposable LOCAL PostgreSQL integration test (no server startup/reset).
 * Preapply migrations. Set INSTALLMENT_TEST_DATABASE=budget_round3_test_<suffix>,
 * INSTALLMENT_TEST_ALLOW_WRITES=1, optional INSTALLMENT_TEST_PORT (default 54322).
 * Requires psql and a local trust-authenticated postgres test role; reads no app secrets.
 * Parent probe mode: INSTALLMENT_TEST_DOCKER_CONTAINER=budget_round3_sql_probe,
 * INSTALLMENT_TEST_DATABASE=round3_check_<number>; uses docker exec with no host connection.
 * Target PG17: container supabase_db_budget-tracker-round3-check, database round3_check_<number>.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const database = process.env.INSTALLMENT_TEST_DATABASE;
const port = process.env.INSTALLMENT_TEST_PORT ?? "54322";
const container = process.env.INSTALLMENT_TEST_DOCKER_CONTAINER;
const dockerDatabases = new Map([
  ["supabase_db_CODEX-BUDGET-MULTIWALLET-SYSTEM-20261105", /^postgres$/],
  ["budget_round3_sql_probe", /^round3_check_\d+$/],
  ["supabase_db_budget-tracker-round3-check", /^round3_check_\d+$/],
]);
if (container && !dockerDatabases.has(container)) throw new Error("Only explicitly designated synthetic Docker probes are allowed");
const permittedDatabase = container ? dockerDatabases.get(container).test(database ?? "")
  : /^budget_(?:round3|cycle)_test_[a-z0-9_]+$/.test(database ?? "");
if (process.env.INSTALLMENT_TEST_ALLOW_WRITES !== "1" || !permittedDatabase) {
  throw new Error("Opt in with INSTALLMENT_TEST_ALLOW_WRITES=1 and a disposable budget_round3_test_<suffix> database");
}
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid local test port");

const owner = randomUUID();
const wallet = randomUUID();
const installment = randomUUID();
const claims = `select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true); set local role authenticated;`;

function session(sql, marker) {
  const common = ["-X", "-q", "-t", "-A", "--no-password", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database];
  const command = container ? "docker" : "psql";
  const args = container ? ["exec", "-i", container, "psql", ...common]
    : [...common, "-h", "127.0.0.1", "-p", port];
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: "", PGSERVICE: "", PGSERVICEFILE: join(tmpdir(), "budget-no-pgservice"),
      PGPASSFILE: join(tmpdir(), "budget-no-pgpass"), PGOPTIONS: "" },
  });
  let output = "", error = "";
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Marker-free callers do not await ready; suppress an irrelevant rejection on failure.
  if (!marker) readyResolve();
  const completed = new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill(), 20000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (marker && output.includes(marker)) readyResolve();
    });
    child.stderr.on("data", (chunk) => { error += chunk.toString(); });
    child.once("error", (cause) => { error += cause.message; });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (marker && !output.includes(marker)) readyReject(new Error(error || "Session ended before test barrier"));
      resolve({ code, output, error });
    });
  });
  child.stdin.on("error", () => {});
  child.stdin.write(sql);
  return { child, ready, completed };
}

async function sql(statement) {
  const run = session(statement);
  run.child.stdin.end();
  const result = await run.completed;
  assert.equal(result.code, 0, result.error || "Local SQL command failed");
  return result.output.trim();
}

// Hold the common profile lock until both separate sessions have submitted their
// RPC work. This is an explicit barrier, with no sleeps or timing-based success.
async function race(left, right) {
  const blocker = session(`begin; select user_id from public.profiles where user_id='${owner}' for update; select 'CYCLE_LOCK_HELD';\n`, "CYCLE_LOCK_HELD");
  await blocker.ready;
  const runs = [left, right].map((statement) => {
    const run = session(`begin; ${claims} select 'CYCLE_REQUEST_READY'; ${statement}; commit;\n`, "CYCLE_REQUEST_READY");
    run.child.stdin.end();
    return run;
  });
  try {
    await Promise.all(runs.map((run) => run.ready));
  } finally {
    blocker.child.stdin.end("commit;\n");
  }
  const results = await Promise.all(runs.map((run) => run.completed));
  assert.equal((await blocker.completed).code, 0, "test barrier must commit");
  return results;
}

const payment = (id, amount, cycle, extra) => `select * from public.record_installment_payment('${id}','${installment}','${wallet}',${amount},current_date,${cycle ? `'${cycle}'` : "null"},${extra ? `'${extra}'` : "null"})`;
const salary = (id, cycle) => `select * from public.receive_salary('${id}',${cycle ? `'${cycle}'` : "null"})`;
const owned = async (statement) => sql(`begin; ${claims} ${statement}; commit;`);
const readState = async () => {
  // Output only the synthetic fixture's aggregate, with one JSON row at the end.
  const result = await sql(`select jsonb_build_object(
    'payments',(select count(*) from public.transactions where user_id='${owner}' and source='installment'),
    'paid',(select coalesce(sum(amount_minor),0) from public.transactions where user_id='${owner}' and source='installment' and deleted_at is null),
    'salaries',(select count(*) from public.transactions where user_id='${owner}' and source='salary'),
    'latestPayment',(select id from public.transactions where user_id='${owner}' and source='installment' order by created_at desc,id desc limit 1),
    'currentReceipt',(select id from public.transactions where user_id='${owner}' and source='salary' and deleted_at is null order by created_at desc,id desc limit 1),
    'remaining',(select remaining_minor from public.installment_progress where installment_id='${installment}')
  );`);
  return JSON.parse(result);
};
const oneWins = (results, message) => {
  assert.equal(results.filter((r) => r.code === 0).length, 1, results.map((r) => r.error).join("\n"));
  assert.match(results.find((r) => r.code !== 0).error, new RegExp(message));
};

try {
  await sql(`begin;
    insert into auth.users(id,instance_id,aud,role,email) values ('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@cycles.example.test');
    ${claims}
    with fixture(id,name,kind,currency) as (values ('${wallet}','Synthetic cycle bank','bank','USD')), containers as (
    insert into public.wallets(id,name,kind,default_balance_id) select id::uuid,name,kind::public.wallet_kind,id::uuid from fixture returning id,user_id
    ) insert into public.wallet_balances(id,user_id,wallet_id,currency,position)
    select c.id,c.user_id,c.id,f.currency,0 from fixture f join containers c on c.id=f.id::uuid;
    insert into public.installments(id,name,total_minor,monthly_minor,balance_id,category_id)
      select '${installment}','Synthetic cycle debt',1000000,10000,'${wallet}',id from public.categories where kind='expense' and parent_id is null order by position limit 1;
    update public.profiles set salary_amount_minor=180000,salary_balance_id='${wallet}';
    commit;`);

  oneWins(await race(payment(randomUUID(), 10000, null, null), payment(randomUUID(), 10000, null, null)), "already paid this cycle");
  let state = await readState();
  assert.deepEqual([state.payments, state.paid, state.remaining], [1, 10000, 990000]);
  oneWins(await race(payment(randomUUID(), 10000, null, state.latestPayment), payment(randomUUID(), 10000, null, state.latestPayment)), "installment payment changed");
  state = await readState();
  assert.deepEqual([state.payments, state.paid, state.remaining], [2, 20000, 980000]);

  const retryId = randomUUID();
  const retry = payment(retryId, 5000, null, state.latestPayment);
  for (const result of await race(retry, retry)) assert.equal(result.code, 0, result.error);
  state = await readState();
  assert.deepEqual([state.payments, state.paid, state.remaining], [3, 25000, 975000]);

  const firstSalary = randomUUID();
  for (const result of await race(salary(firstSalary, null), salary(firstSalary, null))) assert.equal(result.code, 0, result.error);
  state = await readState();
  assert.deepEqual([state.salaries, state.currentReceipt, state.paid, state.remaining], [1, firstSalary, 25000, 975000]);
  oneWins(await race(salary(randomUUID(), firstSalary), salary(randomUUID(), firstSalary)), "salary cycle changed");
  state = await readState();
  assert.equal(state.salaries, 2);

  const thirdSalary = randomUUID();
  const racePayment = randomUUID();
  const results = await race(salary(thirdSalary, state.currentReceipt), payment(racePayment, 10000, state.currentReceipt, null));
  assert.equal(results[0].code, 0, results[0].error);
  if (results[1].code !== 0) assert.match(results[1].error, /salary cycle changed/);
  state = await readState();
  assert.equal(state.currentReceipt, thirdSalary);
  assert.equal(state.paid, results[1].code === 0 ? 35000 : 25000);
  assert.equal(state.remaining, 1000000 - state.paid);
  // set_config emits JWT JSON before the SELECT's JSON; the actual snapshot is
  // the final JSON row, not the first one beginning with an opening brace.
  const snapshot = JSON.parse((await owned("select public.installment_cycle_snapshot()" )).split("\n").filter((line) => line.startsWith("{")).at(-1));
  assert.equal(snapshot.receipt.id, thirdSalary);
  assert.equal(snapshot.payments.filter((p) => p.salary_cycle_id === thirdSalary).length, 0);

  // Regression: canonical lifecycle used to lock transaction -> profile, while
  // same-ID receipt replay locked profile -> transaction. Both now take profile
  // first; Undo must succeed whether replay precedes it or observes its delete.
  const undoRace = await race(salary(thirdSalary, snapshot.receipt.id),
    `select * from public.set_transaction_deleted('${thirdSalary}',1,true)`);
  assert.equal(undoRace[1].code, 0, undoRace[1].error);
  if (undoRace[0].code !== 0) assert.match(undoRace[0].error, /transaction request already used/);
  for (const result of undoRace) assert.doesNotMatch(result.error, /deadlock detected/);
  state = await readState();
  assert.notEqual(state.currentReceipt, thirdSalary);
  await owned(`select * from public.set_transaction_deleted('${thirdSalary}',2,false)`);

  // Same regression for the full cashier-compatible save API. An editor cannot
  // hold the payment transaction/wallet while waiting for a retry's profile.
  const editedPayment = randomUUID();
  await owned(payment(editedPayment, 1000, thirdSalary, null));
  const editStatement = `select * from public.save_transaction('${editedPayment}',1,
    jsonb_build_object('kind','expense','occurredOn',current_date::text,'balanceId','${wallet}',
      'amountMinor',1200,'categoryId',(select category_id from public.installments where id='${installment}'),
      'note','Synthetic cycle debt'),null,null)`;
  const editRace = await race(payment(editedPayment, 1000, thirdSalary, null), editStatement);
  assert.equal(editRace[1].code, 0, editRace[1].error);
  if (editRace[0].code !== 0) assert.match(editRace[0].error, /transaction request already used/);
  for (const result of editRace) assert.doesNotMatch(result.error, /deadlock detected/);
  const afterEdit = await readState();
  assert.equal(afterEdit.paid, state.paid + 1200);
  assert.equal(afterEdit.remaining, 1000000 - afterEdit.paid);
  console.log("PASS installment concurrency: normal, repeat, same-ID retry, salary retry, stale confirmation, salary/payment race, Undo/replay lock order, save/replay lock order");
} finally {
  // References point backward in recording order; delete newest facts first.
  // Only this run's synthetic account is touched. Never reset/truncate a database.
  await sql(`do $$ declare r record; begin
    for r in select id from public.transactions where user_id='${owner}' order by created_at desc,id desc loop
      delete from public.transactions where id=r.id and user_id='${owner}';
    end loop;
    delete from auth.users where id='${owner}';
  end $$;`);
}
