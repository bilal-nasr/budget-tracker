/**
 * Rehearse the full chain over pre-cycle payment data, not just an empty schema.
 * Requires a disposable PostgreSQL 17 Docker container, without host ports:
 * docker run -d --name budget_round3_migration_regression --network none \
 *   --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
 * MIGRATION_TEST_ALLOW_WRITES=1 node scripts/test-installment-cycle-migration.mjs
 * Reads no app credentials and refuses other containers. Its private database is
 * created/dropped by this script; it never connects to a personal/hosted database.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.env.MIGRATION_TEST_ALLOW_WRITES !== "1") throw new Error("Opt in to the disposable migration rehearsal with MIGRATION_TEST_ALLOW_WRITES=1");
const container = "budget_round3_migration_regression";
const database = `round3_migration_${randomUUID().replaceAll("-", "")}`;
const migrations = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const owner = "20000000-0000-4000-8000-000000000001";
const wallet = "20000000-0000-4000-8000-000000000002";
const installment = "20000000-0000-4000-8000-000000000003";
const salary = "20000000-0000-4000-8000-000000000010";
const deletedSalary = "20000000-0000-4000-8000-000000000011";
const firstPayment = "20000000-0000-4000-8000-000000000020";
const secondPayment = "20000000-0000-4000-8000-000000000021";
const cashPurchase = "20000000-0000-4000-8000-000000000030";

function sql(input, db = database, atomic = false) {
  const args = ["exec", "-i", container, "psql", "-XqAt", "--no-password", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"];
  if (atomic) args.push("--single-transaction");
  const result = spawnSync("docker", args, { input, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Disposable migration SQL failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

const snapshot = `select jsonb_build_object(
  'ledger', (select md5(jsonb_agg(jsonb_strip_nulls(to_jsonb(t)-array['revision','updated_at','salary_cycle_id','installment_override_of']) order by id)::text) from public.transactions t),
  'balances', (select md5(jsonb_agg(to_jsonb(w) order by wallet_id)::text) from public.wallet_balances w)
);`;
let created = false;
try {
  sql(`create database ${database};`, "postgres"); created = true;
  const version = sql("show server_version;");
  assert.match(version, /^17\./, "Rehearse against the production PostgreSQL major version");
  sql(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create schema auth; create schema extensions;
  create table auth.users(id uuid primary key,instance_id uuid,aud text,role text,email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid;
  $$;
  grant usage on schema auth,public,extensions to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;
  alter default privileges in schema public grant all on tables to authenticated,service_role;
  alter default privileges in schema public grant all on sequences to authenticated,service_role;`);

  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.filter((f) => f < "20261111000500")) sql(readFileSync(migrations + file, "utf8"), database, true);
  sql(`set local request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';
    insert into auth.users(id,email) values('${owner}','migration-rehearsal@example.test');
    insert into public.wallets(id,user_id,name,kind,currency,opening_balance_minor)
      values('${wallet}','${owner}','Migration rehearsal','cash','USD',50000);
    insert into public.installments(id,user_id,name,currency,wallet_id,category_id,total_minor,monthly_minor)
      select '${installment}','${owner}','Legacy purchase','USD','${wallet}',id,100000,10000
      from public.categories where user_id='${owner}' and kind='expense' order by position,id limit 1;
    insert into public.transactions(id,user_id,kind,occurred_on,created_at,wallet_id,category_id,amount_minor,source,deleted_at)
      select '${salary}','${owner}','income','2026-01-01','2026-01-01T12:00:00Z','${wallet}',id,100000,'salary',null
      from public.categories where user_id='${owner}' and kind='income' order by position,id limit 1;
    insert into public.transactions(id,user_id,kind,occurred_on,created_at,wallet_id,category_id,amount_minor,source,deleted_at)
      select '${deletedSalary}','${owner}','income','2026-01-03','2026-01-03T12:00:00Z','${wallet}',id,100000,'salary','2026-01-05T12:00:00Z'
      from public.categories where user_id='${owner}' and kind='income' order by position,id limit 1;
    insert into public.transactions(id,user_id,kind,occurred_on,created_at,wallet_id,category_id,amount_minor,source,installment_id)
      select '${firstPayment}','${owner}','expense','2026-01-02','2026-01-02T12:00:00Z','${wallet}',category_id,10000,'installment',id
      from public.installments where id='${installment}';
    insert into public.transactions(id,user_id,kind,occurred_on,created_at,wallet_id,category_id,amount_minor,source,installment_id)
      select '${secondPayment}','${owner}','expense','2025-12-01','2026-01-04T12:00:00Z','${wallet}',category_id,5000,'installment',id
      from public.installments where id='${installment}';
    insert into public.transactions(id,user_id,kind,occurred_on,created_at,wallet_id,category_id,amount_minor,tender_minor,change_wallet_id,change_minor)
      select '${cashPurchase}','${owner}','expense','2026-01-04','2026-01-04T13:00:00Z','${wallet}',category_id,5000,20000,'${wallet}',15000
      from public.installments where id='${installment}';
    insert into public.expense_items(transaction_id,user_id,description,amount_minor,position)
      values('${firstPayment}','${owner}','Existing descriptive item',4000,0);`, database, true);
  const before = JSON.parse(sql(snapshot));
  for (const file of files.filter((f) => f >= "20261111000500")) {
    try { sql(readFileSync(migrations + file, "utf8"), database, true); }
    catch (error) { throw new Error(`Migration ${file} must support existing payments. ${error.message}`); }
  }
  assert.deepEqual(JSON.parse(sql(snapshot)), before, "Migration must preserve historical financial fields and balances");
  const links = JSON.parse(sql(`select jsonb_object_agg(id,salary_cycle_id) from public.transactions where installment_id='${installment}';`));
  assert.equal(links[firstPayment], salary);
  assert.equal(links[secondPayment], deletedSalary, "Backdated payment keeps the actual recording-order receipt, including deleted receipt history");
  assert.equal(sql(`select count(*) from public.expense_items where transaction_id='${firstPayment}';`), "1");
  assert.equal(sql(`select tender_minor||':'||change_minor from public.transactions where id='${cashPurchase}';`), "20000:15000");
  console.log("PASS PG17 populated migration rehearsal: live/deleted receipts, backdated payments, breakdowns and cashier settlement survive; financial fields and balances unchanged.");
} finally {
  if (created) sql(`drop database ${database};`, "postgres");
}
