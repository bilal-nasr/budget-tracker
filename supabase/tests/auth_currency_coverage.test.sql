begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
select plan(6);
-- Auth creates users under an unprivileged database role. The security-definer
-- user hook returns before deferred catalog checks run at transaction end.
do $$begin
  if not exists(select from pg_roles where rolname='supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end$$;
-- The minimal SQL fixture lacks GoTrue's role; the real local API uses this
-- same role. Grants are rolled back and never include public wallet access.
grant usage on schema auth, public, extensions to supabase_auth_admin;
grant insert on auth.users to supabase_auth_admin;
set local role supabase_auth_admin;
insert into auth.users(id,email) values('cf000000-0000-4000-8000-000000000001','auth-coverage@example.test');
select lives_ok('set constraints all immediate', 'auth role can commit the seeded catalog without wallet table access');
reset role;
select is((select count(*) from public.currencies where user_id='cf000000-0000-4000-8000-000000000001'),3::bigint,'auth creation retains all seeded definitions');
select ok(not has_table_privilege('supabase_auth_admin','public.wallets','SELECT'), 'auth simulation does not gain wallet reads');
select ok((select prosecdef and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='ledger_private.global_coverage_guard()'::regprocedure), 'coverage runs under the unchanged migration owner');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='ledger_private.global_coverage_guard()'::regprocedure), 'coverage keeps an empty search path');
select ok(not has_function_privilege('authenticated','ledger_private.global_coverage_guard()','EXECUTE') and not has_function_privilege('anon','ledger_private.global_coverage_guard()','EXECUTE'), 'application roles cannot invoke the private trigger function');
select * from finish();
rollback;
