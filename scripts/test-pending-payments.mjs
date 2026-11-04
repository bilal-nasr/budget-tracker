// Uses a disposable portless container, never application credentials:
// docker run -d --rm --name budget_pending_payments_test --network none \
//   --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust \
//   public.ecr.aws/supabase/postgres:17.11.0.011
// node scripts/test-pending-payments.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const container = "budget_pending_payments_test";
const database = `pending_payments_${randomUUID().replaceAll("-", "")}`;
function sql(input, db = database) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-XqAt", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"],
    { input, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
try {
  sql(`create database ${database}`, "postgres");
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
  const files = readdirSync(folder).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    sql(`begin;${readFileSync(new URL(file, folder), "utf8")}commit;`);
  }
  for (const file of ["pending_payments.test.sql"]) {
    const output = sql(`set search_path=public,extensions;${readFileSync(new URL(`../supabase/tests/${file}`, import.meta.url), "utf8")}`);
    console.log(`${file}:\n${output}`);
    assert.doesNotMatch(output, /(?:^|\n)not ok |Looks like you failed/, `${file} must pass`);
  }
  // Independent connections compete for the same receivable. Each request is
  // valid alone, but together they must not be allowed to exceed the total.
  const owner = "ef000000-0000-4000-8000-000000000001";
  const wallet = "ef100000-0000-4000-8000-000000000001";
  const job = "ef200000-0000-4000-8000-000000000001";
  const session = `select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',false); set role authenticated;`;
  sql(`insert into auth.users(id,email) values('${owner}','pending-race@example.test'); ${session}
    insert into public.wallets(id,name,kind,currency) values('${wallet}','Race cash','cash','USD');
    select public.create_pending_payment('{"requestId":"${job}","client":"Race","project":"Website","currency":"USD","totalMinor":10000,"dueOn":null}');`);
  const category = sql(`${session} select id from public.categories where kind::text='income' limit 1;`).split("\n").at(-1);
  function competingReceipt(requestId) {
    const payload = JSON.stringify({ requestId, paymentId: job, walletId: wallet, categoryId: category, amountMinor: 6000, occurredOn: "2026-01-01" });
    return new Promise((resolve) => {
      const process = spawn("docker", ["exec", "-i", container, "psql", "-XqAt", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], { windowsHide: true });
      let output = "";
      process.stdout.on("data", (chunk) => { output += chunk; });
      process.stderr.on("data", (chunk) => { output += chunk; });
      process.on("error", (error) => resolve({ status: -1, output: error.message }));
      process.on("close", (status) => resolve({ status, output }));
      process.stdin.end(`${session} begin; select public.record_pending_receipt('${payload}'); select pg_sleep(0.4); commit;`);
    });
  }
  const races = await Promise.all([
    competingReceipt("ef300000-0000-4000-8000-000000000001"),
    competingReceipt("ef300000-0000-4000-8000-000000000002"),
  ]);
  assert.equal(races.filter((result) => result.status === 0).length, 1, JSON.stringify(races));
  assert.match(races.find((result) => result.status !== 0).output, /pending.exceedsRemaining/);
  assert.equal(sql(`${session} select remaining_minor from public.pending_payment_progress where id='${job}';`).split("\n").at(-1), "4000");
  console.log("Concurrent receipts: one accepted, one rejected; remaining 4000.");
} finally {
  sql(`drop database if exists ${database} with (force)`, "postgres");
}
