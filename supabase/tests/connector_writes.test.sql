-- Connected apps (OAuth clients): the writes public.connector_request_guard() allows (the ones
-- the connector's write tools make), that they run read-write, that a table is open only for
-- its listed verbs, and connector_requests (the retry keys). Who gets in at all, reads, and the
-- refusals are in connector_read_only.test.sql. Synthetic fixtures only; run with pnpm db:test.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, email) values
  ('d0000000-0000-4000-8000-000000000001', 'writes-a@example.test'),
  ('d0000000-0000-4000-8000-000000000002', 'writes-b@example.test');
insert into auth.oauth_clients(id, registration_type, redirect_uris, grant_types, client_name, client_type, token_endpoint_auth_method) values
  ('d7000000-0000-4000-8000-0000000000a1', 'manual', 'http://localhost:8976/callback', 'authorization_code,refresh_token', 'Claude (test)', 'public', 'none');
insert into public.connector_clients(client_id, name) values ('d7000000-0000-4000-8000-0000000000a1', 'Claude (test)');
insert into auth.sessions(id, user_id, oauth_client_id, not_after, created_at, updated_at) values
  ('d5000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-0000000000a1', null, now(), now()),
  ('d5000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-0000000000a1', null, now(), now());

-- The guard as PostgREST runs it, then an optional statement; every setting is rolled back.
create function pg_temp.guard(p_claims text, p_method text, p_path text,
  p_headers text default '{}', p_then text default null)
returns text language plpgsql as $$
begin
  begin
    perform set_config('request.jwt.claims', p_claims, true);
    if p_method is not null then perform set_config('request.method', p_method, true); end if;
    if p_path is not null then perform set_config('request.path', p_path, true); end if;
    if p_headers is not null then perform set_config('request.headers', p_headers, true); end if;
    perform public.connector_request_guard();
    if p_then is not null then execute p_then; end if;
    raise exception using errcode = 'CTEST', message = 'allowed ' ||
      case when current_setting('transaction_read_only') = 'on' then 'read-only' else 'read-write' end;
  exception when others then
    if sqlstate = 'CTEST' then return sqlerrm; end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end $$;

create temp table c(known text, revoked text, stranger text, other text);
insert into c values (
  '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"d7000000-0000-4000-8000-0000000000a1","session_id":"d5000000-0000-4000-8000-000000000001"}',
  '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"d7000000-0000-4000-8000-0000000000a1","session_id":"d5000000-0000-4000-8000-000000000002"}',
  '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"stranger-app","session_id":"d5000000-0000-4000-8000-000000000001"}',
  '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}');
grant select on c to authenticated;

-- Every listed write function passes for a registered app, as POST only, and runs read-write.
create temp table f(name text);
insert into f values ('create_wallet'), ('reorder_wallets'), ('delete_wallet'), ('save_transaction'),
  ('record_balance_transfer'), ('set_transaction_deleted'), ('set_transaction_date'), ('remove_category'),
  ('delete_installment'), ('create_loan'), ('update_loan'), ('delete_loan'), ('record_loan_payment'),
  ('void_loan_payment'), ('create_pending_payment'), ('update_pending_payment'), ('record_pending_receipt'),
  ('receive_salary');
grant select on f to authenticated;
select is((select count(*) from f), 18::bigint, 'fixture: eighteen write functions');
select is(array(select f.name from f where not exists (
    select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name) order by 1),
  array[]::text[], 'every listed write function exists in public');

-- Each table with the verbs its tools use; every other verb on it stays refused.
create temp table t(name text, verbs text[]);
insert into t values
  ('wallets', array['PATCH']), ('categories', array['POST', 'PATCH']), ('budgets', array['POST']),
  ('fixed_expenses', array['POST', 'PATCH', 'DELETE']), ('installments', array['POST', 'PATCH']),
  ('profiles', array['PATCH']), ('shopping_items', array['POST', 'PATCH', 'DELETE']),
  ('invoice_folders', array['POST', 'PATCH', 'DELETE']), ('connector_requests', array['POST', 'PATCH', 'DELETE']);
grant select on t to authenticated;
select is(array(select t.name from t where to_regclass('public.' || t.name) is null order by 1),
  array[]::text[], 'every listed table exists in public');

select set_config('request.jwt.claims', (select known from c), true);
set local role authenticated;

select is(array(select f.name from f where pg_temp.guard((select known from c), 'POST', '/rpc/' || f.name) <> 'allowed read-write' order by 1),
  array[]::text[], 'known app: POST on every listed write function is allowed read-write');
select is(array(select f.name || ' ' || m from f, unnest(array['GET', 'HEAD', 'PATCH', 'PUT', 'DELETE']) m
    where pg_temp.guard((select known from c), m, '/rpc/' || f.name) <> '42501 connector.forbidden' order by 1),
  array[]::text[], 'known app: a write function is refused for every method but POST');
select is(array(select t.name || ' ' || m from t, unnest(array['POST', 'PATCH', 'DELETE', 'PUT']) m
    where pg_temp.guard((select known from c), m, '/' || t.name) <>
      case when m = any (t.verbs) then 'allowed read-write' else '42501 connector.forbidden' end order by 1),
  array[]::text[], 'known app: each listed table is open for exactly its listed verbs, read-write');
select is(array(select t.name from t where pg_temp.guard((select known from c), 'GET', '/' || t.name) <> 'allowed read-only' order by 1),
  array[]::text[], 'known app: reading a listed table is still read-only');

-- The same identity checks come first: an unknown app, a removed app and another schema write nothing.
select is(pg_temp.guard((select stranger from c), 'POST', '/rpc/save_transaction'), '42501 connector.forbidden', 'unknown app: listed write function');
select is(pg_temp.guard((select stranger from c), 'PATCH', '/profiles'), '42501 connector.forbidden', 'unknown app: listed table write');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/save_transaction', '{"content-profile":"graphql_public"}'),
  '42501 connector.forbidden', 'known app: a listed function name in another schema');
select is(pg_temp.guard((select known from c), 'PATCH', '/profiles', '{"content-profile":"graphql_public"}'),
  '42501 connector.forbidden', 'known app: a listed table in another schema');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/save_transaction', null), '42501 connector.forbidden', 'known app: no request headers');
select is(pg_temp.guard((select known from c), 'post', '/rpc/save_transaction'), '42501 connector.forbidden', 'known app: lower-case method');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/save_transaction/x'), '42501 connector.forbidden', 'known app: extra path segment');
select is(pg_temp.guard((select revoked from c), 'POST', '/rpc/save_transaction'), 'allowed read-write', 'second live session: write allowed');
reset role;
delete from auth.sessions where id = 'd5000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.guard((select revoked from c), 'POST', '/rpc/save_transaction'), '42501 connector.forbidden',
  'the app was removed (its session row is gone): its token writes nothing');
select is(pg_temp.guard((select revoked from c), 'PATCH', '/profiles'), '42501 connector.forbidden',
  'the app was removed: table writes refused too');

-- An allowed write really writes, under the app token, and only to the person's own rows.
select is(pg_temp.guard((select known from c), 'POST', '/rpc/create_wallet', '{"x-budget-units":"{\"USD\":2}"}',
  $q$select public.create_wallet('From the app', 'cash', 'USD', 0)$q$), 'allowed read-write', 'known app: create_wallet runs');
select is(pg_temp.guard((select known from c), 'POST', '/categories', '{}',
  $q$insert into public.categories(user_id, kind, name_en, name_ar, tile, color, parent_id)
     values ('d0000000-0000-4000-8000-000000000002', 'expense', 'Not mine', null, 1, (select color from public.categories limit 1), null)$q$),
  '42501 new row violates row-level security policy for table "categories"',
  'known app: an allowed table write is still held to the person''s own rows (RLS)');

-- connector_requests: one row per person and requestId; own rows only.
insert into public.connector_requests(request_id, tool) values ('d9000000-0000-4000-8000-000000000001', 'wallets_create');
select is((select user_id from public.connector_requests where request_id = 'd9000000-0000-4000-8000-000000000001'),
  'd0000000-0000-4000-8000-000000000001'::uuid, 'the claim belongs to the caller by default');
select throws_ok($$insert into public.connector_requests(request_id, tool) values ('d9000000-0000-4000-8000-000000000001', 'wallets_create')$$,
  '23505', null, 'the same requestId cannot be claimed twice');
select throws_ok($$insert into public.connector_requests(user_id, request_id, tool) values ('d0000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000002', 'wallets_create')$$,
  '42501', null, 'a claim cannot be made for another account');
select throws_ok($$insert into public.connector_requests(request_id, tool) values ('d9000000-0000-4000-8000-000000000003', 'Not A Tool')$$,
  '23514', null, 'tool must look like a tool name');
select throws_ok($$insert into public.connector_requests(request_id, tool, result) values ('d9000000-0000-4000-8000-000000000004', 'wallets_create', '[1]')$$,
  '23514', null, 'a recorded result is an object');
update public.connector_requests set result = '{"wallet":{"id":"w"}}' where request_id = 'd9000000-0000-4000-8000-000000000001';
select is((select result -> 'wallet' ->> 'id' from public.connector_requests where request_id = 'd9000000-0000-4000-8000-000000000001'),
  'w', 'the result is recorded on the claim');

-- Another account neither sees nor changes it, and may use the same requestId itself.
select set_config('request.jwt.claims', (select other from c), true);
select is((select count(*) from public.connector_requests), 0::bigint, 'another account sees no claims');
update public.connector_requests set result = '{}' where request_id = 'd9000000-0000-4000-8000-000000000001';
delete from public.connector_requests where request_id = 'd9000000-0000-4000-8000-000000000001';
select lives_ok($$insert into public.connector_requests(request_id, tool) values ('d9000000-0000-4000-8000-000000000001', 'wallets_create')$$,
  'the same requestId under another account is its own claim');
select set_config('request.jwt.claims', (select known from c), true);
select is((select result -> 'wallet' ->> 'id' from public.connector_requests where request_id = 'd9000000-0000-4000-8000-000000000001'),
  'w', 'the first account''s claim is untouched by the other account''s update and delete');
reset role;
set local role anon;
select throws_ok('select count(*) from public.connector_requests', '42501', null, 'anon cannot read connector_requests');
reset role;

-- Removing the account removes its claims.
delete from auth.users where id = 'd0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.connector_requests where user_id = 'd0000000-0000-4000-8000-000000000001'), 0::bigint,
  'claims go with the account');

select * from finish();
rollback;
