// Uses a disposable portless container, never application credentials:
// docker run -d --rm --name budget_cashier_rate_test --network none \
//   --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust \
//   public.ecr.aws/supabase/postgres:17.11.0.011
// node scripts/test-cashier-rates.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const container = "budget_cashier_rate_test";
const database = `cashier_rates_${randomUUID().replaceAll("-", "")}`;
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
  for (const file of ["cashier_without_rate.test.sql", "cashier_settlement.test.sql", "expense_breakdowns.test.sql", "isolation.test.sql"]) {
    const output = sql(`set search_path=public,extensions;${readFileSync(new URL(`../supabase/tests/${file}`, import.meta.url), "utf8")}`);
    console.log(`${file}:\n${output}`);
    assert.doesNotMatch(output, /(?:^|\n)not ok |Looks like you failed/, `${file} must pass`);
  }
} finally {
  sql(`drop database if exists ${database} with (force)`, "postgres");
}
