/**
 * Explicit opt-in two-connection regression for the designated disposable PG17
 * database. Never points at a remote database or reads application secrets.
 * CATEGORY_ORDER_TEST_ALLOW_FIXTURES=1
 * CATEGORY_ORDER_TEST_DOCKER_CONTAINER=supabase_db_budget-tracker-round3-check
 * CATEGORY_ORDER_TEST_DATABASE=round3_check_17
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const container = process.env.CATEGORY_ORDER_TEST_DOCKER_CONTAINER;
const database = process.env.CATEGORY_ORDER_TEST_DATABASE;
if (process.env.CATEGORY_ORDER_TEST_ALLOW_FIXTURES !== "1"
    || container !== "supabase_db_budget-tracker-round3-check"
    || !/^round3_check_\d+$/.test(database ?? "")) {
  throw new Error("Category order concurrency requires the designated disposable PG17 database and explicit fixture opt-in");
}

const args = ["exec", "-i", "-e", "PGPASSWORD=", "-e", "PGOPTIONS=", "-e", "PGPASSFILE=/tmp/budget-no-pgpass",
  container, "env", "-u", "PGSERVICE", "-u", "PGSERVICEFILE", "psql", "-XqAt", "--no-password", "-U", "postgres",
  "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const runFile = promisify(execFile);
const owner = randomUUID();
const claims = `set local role authenticated; select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);`;
const active = new Set();

async function sql(statement) {
  const result = await runFile("docker", [...args, "--command", statement], { windowsHide: true, timeout: 30_000 });
  return result.stdout.trim();
}

function session(applicationName) {
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
  if (applicationName) child.stdin.write(`set application_name='${applicationName}';\n`);
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

async function waitForLock(observer, applicationName, marker) {
  observer.send(`reset role; do $$ declare deadline timestamptz := clock_timestamp()+interval '8 seconds'; waiting boolean;
    begin loop
      select wait_event_type='Lock' into waiting from pg_stat_activity where application_name='${applicationName}';
      if waiting then exit; end if;
      if clock_timestamp()>deadline then raise exception 'category writer wait barrier timed out'; end if;
      perform pg_sleep(0.005); perform pg_stat_clear_snapshot();
    end loop; end $$; select '${marker}';`);
  await observer.wait(marker);
}

async function orderedIds() {
  const output = await sql(`begin; ${claims}
    select string_agg(id::text,',' order by position desc) from public.categories
    where kind='expense' and parent_id is null and archived_at is null; commit;`);
  return output.split(/\r?\n/).find((line) => line.includes(","));
}

async function runBlockedWriter(label, writerSql) {
  const ids = await orderedIds();
  assert.ok(ids);
  const reorder = session();
  reorder.send(`begin; ${claims} select public.reorder_categories('expense','{${ids}}'::uuid[]); select 'REORDER_READY';`);
  await reorder.wait("REORDER_READY");
  const applicationName = `category-order-${label}-${randomUUID()}`;
  const writer = session(applicationName);
  writer.send(`begin; ${claims} select 'WRITER_STARTED'; ${writerSql} commit;`);
  await writer.wait("WRITER_STARTED");
  try { await waitForLock(reorder, applicationName, "WRITER_WAITING"); }
  catch (error) { await reorder.end("rollback;\n"); await writer.end(); throw error; }
  const first = await reorder.end("commit;\n");
  const second = await writer.end();
  assert.equal(first.code, 0, first.errors);
  assert.equal(second.code, 0, second.errors);
  const positions = await sql(`begin; ${claims}
    select count(*)||'|'||count(distinct position)||'|'||min(position)||'|'||max(position)
    from public.categories where kind='expense' and parent_id is null and archived_at is null; commit;`);
  const state = positions.split(/\r?\n/).find((line) => /^\d+\|\d+\|\d+\|\d+$/.test(line));
  const [count, distinct, min, max] = state.split("|").map(Number);
  assert.deepEqual([distinct, min, max], [count, 1, count], `${label} must leave one dense active order`);
  console.log(`PASS ${label}: writer waited for reorder and active positions remain dense`);
}

let created = false;
try {
  const version = Number(await sql("select current_setting('server_version_num');"));
  assert.ok(version >= 170000 && version < 180000, "category order concurrency targets PostgreSQL 17");
  await sql(`insert into auth.users(id,instance_id,aud,role,email) values('${owner}',
    '00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@category-order.example.test');`);
  created = true;
  await runBlockedWriter("create", "insert into public.categories(kind,name_en,tile,color) values('expense','Concurrent create',1,'teal');");
  const archived = await sql(`begin; ${claims}
    update public.categories set archived_at=now() where id=(select id from public.categories where kind='expense' and archived_at is null order by position limit 1) returning id; commit;`);
  const archivedId = archived.split(/\r?\n/).find((line) => /^[a-f0-9-]{36}$/.test(line));
  assert.ok(archivedId);
  await runBlockedWriter("restore", `update public.categories set archived_at=null where id='${archivedId}';`);
} finally {
  await Promise.all([...active].map((child) => new Promise((resolve) => { child.once("close", resolve); child.kill(); })));
  if (created) {
    try { await sql(`delete from auth.users where id='${owner}';`); }
    catch { console.error("Synthetic category-order fixture cleanup failed"); process.exitCode = 1; }
  }
}
