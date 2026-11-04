// Runs only in a disposable, portless PG17 container; never reads app credentials.
// docker run -d --rm --name budget_performance_regression --network none \
//   --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
// node scripts/test-performance.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const container = "budget_performance_regression";
const database = `performance_${randomUUID().replaceAll("-", "")}`;
function sql(input, db = database) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-XqAt", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"],
    { input, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
const owner = "60000000-0000-4000-8000-000000000001";
const other = "60000000-0000-4000-8000-000000000002";
const source = "61000000-0000-4000-8000-000000000001";
const receiver = "61000000-0000-4000-8000-000000000002";
const asOwner = `set role authenticated; set request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';`;
const balances = `${asOwner} select jsonb_agg(to_jsonb(b) order by wallet_id) from public.wallet_balances b;`;
const explain = `${asOwner} explain (analyze,buffers,format json) select * from public.wallet_balances where wallet_id='${receiver}';`;
try {
  sql(`create database ${database}`, "postgres");
  assert.match(sql("show server_version"), /^17\./);
  sql(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create schema auth; create schema extensions;
  create table auth.users(id uuid primary key,instance_id uuid,aud text,role text,email text);
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
  $$;
  grant usage on schema auth,public,extensions to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;
  alter default privileges in schema public grant all on tables to authenticated,service_role;
  alter default privileges in schema public grant all on sequences to authenticated,service_role;`);
  const folder = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(folder).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.filter((f) => f < "20261113000000")) sql(`begin;${readFileSync(new URL(file, folder), "utf8")}commit;`);
  sql(`insert into auth.users(id,email) values('${owner}','performance-a@example.test'),('${other}','performance-b@example.test');
    ${asOwner}
    insert into public.wallets(id,name,kind,currency,opening_balance_minor) values
      ('${source}','Synthetic source','cash','USD',1000000),('${receiver}','Synthetic change','cash','USD',0);
    insert into public.transactions(kind,occurred_on,wallet_id,category_id,amount_minor)
      select 'expense','2026-11-01','${source}',(select id from public.categories where kind='expense' order by position,id limit 1),100
      from generate_series(1,10000);
    insert into public.transactions(kind,occurred_on,wallet_id,category_id,amount_minor,tender_minor,change_wallet_id,change_minor)
      select 'expense','2026-11-02','${source}',id,100,200,'${receiver}',100
      from public.categories where kind='expense' order by position,id limit 1;
    insert into public.transactions(kind,occurred_on,wallet_id,category_id,amount_minor)
      select 'income','2026-11-02','${source}',id,1000 from public.categories where kind='income' order by position,id limit 1;
    insert into public.transactions(kind,occurred_on,wallet_id,to_wallet_id,amount_minor,to_amount_minor)
      values('transfer','2026-11-02','${source}','${receiver}',50,50);
    reset role; analyze public.transactions;`);
  const before = JSON.parse(sql(balances));
  const beforePlan = JSON.parse(sql(explain))[0];
  assert.equal(before.find((w) => w.wallet_id === source).balance_minor, 750);
  assert.equal(before.find((w) => w.wallet_id === receiver).balance_minor, 150);
  assert.ok(!JSON.stringify(beforePlan).includes("transactions_change_wallet_idx"), "Baseline must reproduce the obscured index predicate");
  for (const file of files.filter((f) => f >= "20261113000000")) sql(`begin;${readFileSync(new URL(file, folder), "utf8")}commit;`);
  assert.deepEqual(JSON.parse(sql(balances)), before, "Migration preserves exact wallet balances");
  const afterPlan = JSON.parse(sql(explain))[0];
  assert.ok(JSON.stringify(afterPlan).includes("transactions_change_wallet_idx"), "Typed predicate uses the existing change-wallet index");
  assert.equal(sql(`set role authenticated; set request.jwt.claims='{"sub":"${other}","role":"authenticated"}';
    select count(*) from public.wallet_balances;`), "0", "Another user cannot read these balances");
  sql(`${asOwner} update public.transactions set deleted_at=now() where change_wallet_id='${receiver}';`);
  assert.equal(JSON.parse(sql(balances)).find((w) => w.wallet_id === receiver).balance_minor, 50);
  sql(`${asOwner} update public.transactions set deleted_at=null where change_wallet_id='${receiver}';`);
  assert.deepEqual(JSON.parse(sql(balances)), before, "Restoring a cashier expense restores exactly one tender/change pair");

  // Summary and full history must agree even across initial/current receipt
  // membership, backdated accounting dates, breakdowns and soft deletion.
  const installment = "62000000-0000-4000-8000-000000000001";
  const receiptId = "63000000-0000-4000-8000-000000000001";
  sql(`${asOwner}
    insert into public.installments(id,name,currency,wallet_id,category_id,total_minor,paid_before_minor,monthly_minor)
      select '${installment}','Synthetic installment','USD','${source}',id,100000,2000,3000
      from public.categories where kind='expense' order by position,id limit 1;
    insert into public.transactions(kind,occurred_on,created_at,wallet_id,category_id,amount_minor,source,installment_id)
      select 'expense','2026-11-01','2026-11-01T10:00:00Z','${source}',category_id,1000,'installment',id
      from public.installments where id='${installment}';
    insert into public.transactions(id,kind,occurred_on,created_at,wallet_id,category_id,amount_minor,source)
      select '${receiptId}','income','2026-11-02','2026-11-02T10:00:00Z','${source}',id,100000,'salary'
      from public.categories where kind='income' order by position,id limit 1;
    do $$ declare previous uuid; begin
      for n in 1..35 loop
        select id into previous from public.record_installment_payment(
          gen_random_uuid(),'${installment}','${source}',100,'2026-09-01','${receiptId}',previous);
      end loop;
    end $$;`);
  function checkSummary() {
    const full = JSON.parse(sql(`${asOwner} select public.installment_cycle_snapshot();`));
    const compact = JSON.parse(sql(`${asOwner} select public.installment_cycle_summary();`));
    assert.deepEqual(compact.receipt, full.receipt && { id: full.receipt.id, occurred_on: full.receipt.occurred_on, created_at: full.receipt.created_at });
    for (const item of compact.installments) {
      const payments = full.payments.filter((p) => p.installment_id === item.id);
      const current = payments.filter((p) => p.salary_cycle_id === (compact.receipt?.id ?? null));
      assert.equal(item.paid_minor, item.paid_before_minor + payments.reduce((sum, p) => sum + p.amount_minor, 0));
      assert.equal(item.remaining_minor, item.total_minor - item.paid_minor);
      assert.equal(item.paid_this_cycle_minor, current.reduce((sum, p) => sum + p.amount_minor, 0));
      assert.equal(item.cycle_payment_count, current.length);
      assert.equal(item.cycle_latest_payment_id, current[0]?.id ?? null);
      assert.equal(item.payments, undefined);
    }
    assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length / 10, "Summary excludes historical parents");
  }
  checkSummary();
  sql(`${asOwner} update public.transactions set deleted_at=now() where id='${receiptId}';`);
  checkSummary();
  assert.deepEqual(JSON.parse(sql(`set role authenticated; set request.jwt.claims='{"sub":"${other}","role":"authenticated"}'; select public.installment_cycle_summary();`)), { receipt: null, installments: [] });

  const loan = sql(`${asOwner} select id from public.create_loan(jsonb_build_object(
    'requestId',gen_random_uuid(),'name','Synthetic loan','direction','borrowed','walletId','${source}',
    'feeCategoryId',(select id from public.categories where kind='expense' order by position,id limit 1),
    'openedOn','2026-01-01','creationMode','existing','principalMinor',100000,'feeBps',1000,
    'principalPaidBeforeMinor',0,'feePaidBeforeMinor',0));`);
  for (let n = 0; n < 35; n++) sql(`${asOwner} select id from public.record_loan_payment(jsonb_build_object(
    'requestId',gen_random_uuid(),'loanId','${loan}','walletId','${source}','amountMinor',100,'occurredOn','2026-11-03'));`);
  const overview = JSON.parse(sql(`${asOwner} select to_jsonb(l) from public.loan_overview l where id='${loan}';`));
  assert.equal(overview.live_payment_count, 35);
  assert.equal(overview.latest_payment_sequence, 35);
  assert.equal(overview.latest_payment_on, "2026-11-03");
  const first = JSON.parse(sql(`${asOwner} select jsonb_agg(to_jsonb(t)) from (select id,loan_event_seq from public.transactions where loan_id='${loan}' order by loan_event_seq desc limit 30) t;`));
  const second = JSON.parse(sql(`${asOwner} select jsonb_agg(to_jsonb(t)) from (select id,loan_event_seq from public.transactions where loan_id='${loan}' and loan_event_seq<${first.at(-1).loan_event_seq} order by loan_event_seq desc limit 30) t;`));
  assert.equal(new Set([...first, ...second].map((r) => r.id)).size, 35, "Keyset history retains every event without duplicates");
  sql(`${asOwner} select id from public.void_loan_payment('${overview.latest_payment_id}',${overview.latest_payment_revision});`);
  const afterVoid = JSON.parse(sql(`${asOwner} select to_jsonb(l) from public.loan_overview l where id='${loan}';`));
  assert.equal(afterVoid.live_payment_count, 34);
  assert.equal(afterVoid.latest_payment_sequence, 34);
  assert.equal(sql(`set role authenticated; set request.jwt.claims='{"sub":"${other}","role":"authenticated"}'; select count(*) from public.loan_overview;`), "0");
  console.log(JSON.stringify({ result: "PASS", rows: 10003, beforeMs: beforePlan["Execution Time"], afterMs: afterPlan["Execution Time"], index: "transactions_change_wallet_idx", checks: ["financial equivalence", "RLS", "delete/restore", "index plan"] }));
  console.log("PASS installment summary/full-snapshot equivalence, initial/current cycles, keyset history, loan ordering facts and cross-user isolation");
} finally {
  sql(`drop database if exists ${database}`, "postgres");
}
