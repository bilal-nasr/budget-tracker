-- Connected apps (OAuth clients): who the API pre-request guard public.connector_request_guard()
-- lets in, that reads run read-only, and that everything not listed is refused. The writes it
-- does allow are in connector_writes.test.sql. Synthetic fixtures only; run with pnpm db:test.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, email) values
  ('c0000000-0000-4000-8000-000000000001', 'connector-a@example.test'),
  ('c0000000-0000-4000-8000-000000000002', 'connector-b@example.test');
-- Supabase Auth's OAuth clients: the id is the public client_id an app token carries.
-- ...a1 is registered for the connector; ...a2 is another app of the same project.
insert into auth.oauth_clients(id, registration_type, redirect_uris, grant_types, client_name, client_type, token_endpoint_auth_method) values
  ('c7000000-0000-4000-8000-0000000000a1', 'manual', 'http://localhost:8976/callback', 'authorization_code,refresh_token', 'Claude (test)', 'public', 'none'),
  ('c7000000-0000-4000-8000-0000000000a2', 'manual', 'http://localhost:8977/callback', 'authorization_code,refresh_token', 'Other (test)', 'public', 'none');
-- One registered app; 'stranger-app' is deliberately not registered.
insert into public.connector_clients(client_id, name) values ('c7000000-0000-4000-8000-0000000000a1', 'Claude (test)');
-- App sessions of the registered app: 01 live; 02 deleted below, as removing the app
-- (revokeGrant) deletes it; 03 past its not_after; 04 with a not_after still ahead.
-- 05 is the same person's live session of the OTHER app; 06 is another person's live
-- session of the registered app. 07 is the same person's ordinary sign-in session (no app).
insert into auth.sessions(id, user_id, oauth_client_id, not_after, created_at, updated_at) values
  ('c5000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', null, null, now(), now()),
  ('c5000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000a1', null, now(), now()),
  ('c5000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000a1', null, now(), now()),
  ('c5000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000a1', now() - interval '1 minute', now(), now()),
  ('c5000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000a1', now() + interval '1 hour', now(), now()),
  ('c5000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000a2', null, now(), now()),
  ('c5000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-0000000000a1', null, now(), now());

-- Runs the guard the way PostgREST does (claims, method, path, headers as
-- transaction-local settings), then the optional follow-up statement, and
-- reports what happened. The block always ends in an error, so every setting
-- it changed (including transaction_read_only) is rolled back after each call.
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

create temp table c(session text, known text, stranger text, revoked text);
insert into c values (
  '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"c7000000-0000-4000-8000-0000000000a1","session_id":"c5000000-0000-4000-8000-000000000001"}',
  '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"stranger-app","session_id":"c5000000-0000-4000-8000-000000000001"}',
  '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"c7000000-0000-4000-8000-0000000000a1","session_id":"c5000000-0000-4000-8000-000000000002"}');
-- How many times auth.sessions has been scanned in this transaction (pg_stat_xact_*), to show
-- whether a guard call looked at it at all.
create function pg_temp.session_scans() returns bigint language sql as $$
  select coalesce(sum(coalesce(seq_scan, 0) + coalesce(idx_scan, 0)), 0)::bigint
  from pg_catalog.pg_stat_xact_all_tables where schemaname = 'auth' and relname = 'sessions'
$$;
grant select on c to authenticated, anon;

select set_config('request.jwt.claims', (select session from c), true);
set local role authenticated;

-- The account owns a folder with a share link (made before any read-only call).
insert into public.invoice_folders(id, name) values ('c1000000-0000-4000-8000-0000000000f1', 'Shared');
select ok(length(public.rotate_invoice_link('c1000000-0000-4000-8000-0000000000f1', 'Owner')) > 0, 'fixture: share link made');

-- Registration: the hook is set on the API role.
select ok(exists(select 1 from pg_roles r, unnest(r.rolconfig) s
  where r.rolname = 'authenticator' and s = 'pgrst.db_pre_request=public.connector_request_guard'),
  'the guard is the API pre-request hook');

-- Ordinary session (no client_id): everything passes untouched.
select is(pg_temp.guard((select session from c), 'GET', '/wallets'), 'allowed read-write', 'session: GET table');
select is(pg_temp.guard((select session from c), 'POST', '/transactions'), 'allowed read-write', 'session: POST table');
select is(pg_temp.guard((select session from c), 'PATCH', '/wallets'), 'allowed read-write', 'session: PATCH table');
select is(pg_temp.guard((select session from c), 'DELETE', '/categories'), 'allowed read-write', 'session: DELETE table');
select is(pg_temp.guard((select session from c), 'POST', '/rpc/save_transaction'), 'allowed read-write', 'session: write rpc');
select is(pg_temp.guard((select session from c), 'POST', '/rpc/graphql', '{"content-profile":"graphql_public"}'),
  'allowed read-write', 'session: graphql');
select is(pg_temp.guard((select session from c), 'POST', '/transactions', '{}', 'delete from public.categories where false'),
  'allowed read-write', 'session: a write statement still runs after the guard');
select is(pg_temp.guard('', null, null), 'allowed read-write', 'no request context (direct SQL): passes');

-- Unknown app: refused outright, reads included.
select is(pg_temp.guard((select stranger from c), 'GET', '/wallets'), '42501 connector.forbidden', 'unknown app: GET table');
select is(pg_temp.guard((select stranger from c), 'POST', '/rpc/month_budgets'), '42501 connector.forbidden', 'unknown app: read rpc');
select is(pg_temp.guard((select stranger from c), 'POST', '/transactions'), '42501 connector.forbidden', 'unknown app: POST table');
select is(pg_temp.guard(replace((select known from c), '"c7000000-0000-4000-8000-0000000000a1"', '""'), 'GET', '/wallets'),
  '42501 connector.forbidden', 'empty client_id');
select is(pg_temp.guard(replace((select known from c), '"c7000000-0000-4000-8000-0000000000a1"', 'null'), 'GET', '/wallets'),
  '42501 connector.forbidden', 'null client_id');
select is(pg_temp.guard(replace((select known from c), '"c7000000-0000-4000-8000-0000000000a1"', '["c7000000-0000-4000-8000-0000000000a1"]'), 'GET', '/wallets'),
  '42501 connector.forbidden', 'non-string client_id');
select is(pg_temp.guard(replace((select known from c), '"c7000000-0000-4000-8000-0000000000a1"', '"C7000000-0000-4000-8000-0000000000A1"'), 'GET', '/wallets'),
  '42501 connector.forbidden', 'client_id is matched exactly');
select is(pg_temp.guard('{"client_id": "c7000000-0000-4000-8000-0000000000a1"', 'GET', '/wallets'),
  '42501 connector.forbidden', 'unparsable claims are refused');

-- Registered app: reads pass and the transaction is made read-only.
select is(pg_temp.guard((select known from c), 'GET', '/wallets'), 'allowed read-only', 'known app: GET table');
select is(pg_temp.guard((select known from c), 'HEAD', '/transactions'), 'allowed read-only', 'known app: HEAD table');
select is(pg_temp.guard((select known from c), 'GET', 'wallets'), 'allowed read-only', 'known app: path without leading slash');
select is(pg_temp.guard((select known from c), 'GET', '/wallets', '{"accept-profile":"public"}'),
  'allowed read-only', 'known app: explicit public profile');
select is(pg_temp.guard((select known from c), 'GET', '/wallets', '{}', 'delete from public.categories where false'),
  '25006 cannot execute DELETE in a read-only transaction', 'known app: a write after an allowed read fails');

-- Registered app: the token's own session must still exist. Removing the app (revokeGrant)
-- deletes that session, so its earlier, still-signed access token is refused at once.
select is(pg_temp.guard((select stranger from c), 'GET', '/wallets'), '42501 connector.forbidden',
  'unknown app with a live session: still refused');
select is(pg_temp.guard((select revoked from c), 'GET', '/wallets'), 'allowed read-only', 'known app, second live session: GET table');
reset role;
delete from auth.sessions where id = 'c5000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.guard((select revoked from c), 'GET', '/wallets'), '42501 connector.forbidden',
  'known app: its session row was deleted (app removed): refused');
select is(pg_temp.guard((select revoked from c), 'POST', '/rpc/month_budgets'), '42501 connector.forbidden',
  'known app, deleted session: read rpc refused too');
select is(pg_temp.guard((select known from c), 'GET', '/wallets'), 'allowed read-only',
  'known app: the other live session is unaffected');
select is(pg_temp.guard(((select known from c)::jsonb - 'session_id')::text, 'GET', '/wallets'), '42501 connector.forbidden',
  'known app: no session_id claim');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"not-a-uuid"')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: malformed session_id');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '""')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: empty session_id');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', 'null')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: null session_id');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '["c5000000-0000-4000-8000-000000000001"]')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: non-string session_id');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"C5000000-0000-4000-8000-000000000001"')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: upper-case session_id (only the canonical lower-case form)');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-000000000001 "')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: session_id with trailing space');

-- The session must belong to this token: same person, same app, not past its end.
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-000000000006"')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: another person''s live session of the same app');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-000000000005"')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: the same person''s live session of a different app');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-000000000003"')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: a session past its not_after');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-000000000007"')::text, 'GET', '/wallets'),
  '42501 connector.forbidden', 'known app: the same person''s live ordinary session (no oauth_client_id)');
select is(pg_temp.guard(jsonb_set((select known from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-000000000004"')::text, 'GET', '/wallets'),
  'allowed read-only', 'known app: a session whose not_after is still ahead');
select is(pg_temp.guard(jsonb_set(jsonb_set((select known from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-000000000006"'),
    '{sub}', '"c0000000-0000-4000-8000-000000000002"')::text, 'GET', '/wallets'),
  'allowed read-only', 'the other person''s own token for that session: allowed (the refusal above is about the pairing)');

-- Ordinary sessions never touch auth.sessions: allowed with no session_id, and with one that
-- matches no row, and the table's scan count does not move. An app token's call does move it,
-- so the counter is shown to work.
reset role;
create temp table scans(label text, n bigint);
insert into scans values ('start', pg_temp.session_scans());
select is(pg_temp.guard((select session from c), 'GET', '/wallets'), 'allowed read-write', 'session without session_id: allowed');
select is(pg_temp.guard(jsonb_set((select session from c)::jsonb, '{session_id}', '"c5000000-0000-4000-8000-0000000000ff"')::text, 'POST', '/transactions'),
  'allowed read-write', 'session whose session_id matches no auth.sessions row: allowed');
insert into scans values ('after sessions', pg_temp.session_scans());
select is((select n from scans where label = 'after sessions'), (select n from scans where label = 'start'),
  'ordinary sessions: the guard did not read auth.sessions');
select is(pg_temp.guard((select known from c), 'GET', '/wallets'), 'allowed read-only', 'known app: GET table (counter check)');
select ok(pg_temp.session_scans() > (select n from scans where label = 'after sessions'),
  'an app token: the guard did read auth.sessions');
grant select on scans to authenticated;
set local role authenticated;

select is(left(pg_temp.guard((select known from c), 'GET', '/wallets', '{}',
  $q$select public.create_wallet('Sneaky', 'cash', 'USD', 0)$q$), 5),
  '25006', 'known app: a security definer write after an allowed read fails as read-only (at its first locking read)');
select is(pg_temp.guard((select session from c), 'POST', '/rpc/create_wallet', '{}',
  $q$select public.create_wallet('Fine', 'cash', 'USD', 0)$q$),
  'allowed read-write', 'session: the same security definer write runs');

-- Registered app: a table write that no tool makes is refused (transactions and categories
-- deletes among them: money moves only through the listed functions).
select is(pg_temp.guard((select known from c), 'POST', '/transactions'), '42501 connector.forbidden', 'known app: POST table');
select is(pg_temp.guard((select known from c), 'PATCH', '/transactions'), '42501 connector.forbidden', 'known app: PATCH table');
select is(pg_temp.guard((select known from c), 'DELETE', '/transactions'), '42501 connector.forbidden', 'known app: DELETE transactions');
select is(pg_temp.guard((select known from c), 'POST', '/wallets'), '42501 connector.forbidden', 'known app: POST wallets (only PATCH is listed)');
select is(pg_temp.guard((select known from c), 'DELETE', '/wallets'), '42501 connector.forbidden', 'known app: DELETE wallets');
select is(pg_temp.guard((select known from c), 'PUT', '/wallets'), '42501 connector.forbidden', 'known app: PUT table');
select is(pg_temp.guard((select known from c), 'DELETE', '/categories'), '42501 connector.forbidden', 'known app: DELETE table');
select is(pg_temp.guard((select known from c), 'OPTIONS', '/wallets'), '42501 connector.forbidden', 'known app: other method');

-- Registered app: the read functions the connector's tools call pass, and run read-only.
select is(pg_temp.guard((select known from c), 'POST', '/rpc/month_budgets', '{}',
  'select count(*) from public.month_budgets(current_date)'), 'allowed read-only', 'known app: month_budgets');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/month_category_spend', '{}',
  'select count(*) from public.month_category_spend(current_date)'), 'allowed read-only', 'known app: month_category_spend');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/category_spend_between', '{}',
  'select count(*) from public.category_spend_between(current_date - 30, null)'), 'allowed read-only', 'known app: category_spend_between');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/installment_cycle_summary', '{}',
  'select public.installment_cycle_summary()'), 'allowed read-only', 'known app: installment_cycle_summary');
select is(pg_temp.guard((select known from c), 'GET', '/rpc/month_budgets'), 'allowed read-only', 'known app: GET read rpc');

-- Registered app: any function not on an allowlist is refused, writes and reads alike.
select is(pg_temp.guard((select known from c), 'POST', '/rpc/create_currency'), '42501 connector.forbidden', 'known app: create_currency');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/settle_and_delete_wallet'), '42501 connector.forbidden', 'known app: settle_and_delete_wallet');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/rotate_invoice_link'), '42501 connector.forbidden', 'known app: rotate_invoice_link');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/join_invoice_folder'), '42501 connector.forbidden', 'known app: join_invoice_folder');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/mark_invoice_items_paid'), '42501 connector.forbidden', 'known app: mark_invoice_items_paid');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/invoice_link_preview'), '42501 connector.forbidden',
  'known app: a stable function not on the allowlist');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/installment_cycle_snapshot'), '42501 connector.forbidden',
  'known app: a plain read no connector tool uses');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/connector_request_guard'), '42501 connector.forbidden',
  'known app: the guard itself');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/graphql', '{"content-profile":"graphql_public"}'),
  '42501 connector.forbidden', 'known app: GraphQL');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/month_budgets', '{"content-profile":"graphql_public"}'),
  '42501 connector.forbidden', 'known app: allowlisted name in another schema');
select is(pg_temp.guard((select known from c), 'GET', '/wallets', '{"accept-profile":"graphql_public"}'),
  '42501 connector.forbidden', 'known app: table read in another schema');
select is(pg_temp.guard((select known from c), 'PATCH', '/rpc/month_budgets'), '42501 connector.forbidden', 'known app: PATCH rpc');

-- Registered app: anything the guard cannot parse is refused (fail closed).
select is(pg_temp.guard((select known from c), 'GET', '/wallets', null), '42501 connector.forbidden', 'no request headers');
select is(pg_temp.guard((select known from c), 'GET', '/wallets', ''), '42501 connector.forbidden', 'empty request headers');
select is(pg_temp.guard((select known from c), 'GET', '/wallets', '{"accept'), '42501 connector.forbidden', 'unparsable request headers');
select is(pg_temp.guard((select known from c), 'GET', '/wallets', '["x"]'), '42501 connector.forbidden', 'request headers not an object');
select is(pg_temp.guard((select session from c), 'GET', '/wallets', null), 'allowed read-write', 'session: no request headers still passes');
select is(pg_temp.guard((select known from c), 'GET', ''), '42501 connector.forbidden', 'empty path');
select is(pg_temp.guard((select known from c), 'GET', null), '42501 connector.forbidden', 'no path');
select is(pg_temp.guard((select known from c), null, '/wallets'), '42501 connector.forbidden', 'no method');
select is(pg_temp.guard((select known from c), 'get', '/wallets'), '42501 connector.forbidden', 'lower-case method');
select is(pg_temp.guard((select known from c), 'GET', '/'), '42501 connector.forbidden', 'API root');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/'), '42501 connector.forbidden', 'rpc without a name');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/month_budgets/x'), '42501 connector.forbidden', 'extra path segment');
select is(pg_temp.guard((select known from c), 'GET', '/wallets/'), '42501 connector.forbidden', 'trailing slash');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/month%5Fbudgets'), '42501 connector.forbidden', 'encoded path');
select is(pg_temp.guard((select known from c), 'POST', '/rpc/Month_Budgets'), '42501 connector.forbidden', 'name case differs');

-- The allowlisted names resolve to exactly these four functions, which stay plain,
-- invoker, non-volatile reads. A new overload or a changed function fails here:
-- re-verify its body before updating the pin.
select is(array(select p.oid::regprocedure::text from pg_proc p
    where p.proname in ('month_budgets','month_category_spend','category_spend_between','installment_cycle_summary')
    order by 1),
  array['category_spend_between(date,date)','installment_cycle_summary()','month_budgets(date)','month_category_spend(date)'],
  'allowlisted names: exactly four functions, no overloads in any schema');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('month_budgets','month_category_spend','category_spend_between','installment_cycle_summary')
  and p.provolatile = 's' and not p.prosecdef and p.prolang = (select l.oid from pg_language l where l.lanname = 'sql')),
  4::bigint, 'allowlisted read functions are stable security invoker sql');

-- Share links: an app token never sees a link token, directly or embedded.
select is((select count(*) from public.invoice_links), 1::bigint, 'session: owner reads their share link');
select set_config('request.jwt.claims', (select known from c), true);
select is((select count(*) from public.invoice_links), 0::bigint, 'known app: no share links');
select is((select count(*) from public.invoice_folders where id = 'c1000000-0000-4000-8000-0000000000f1'), 1::bigint,
  'known app: still reads the folder');
select is((select count(l.token) from public.invoice_folders f
    left join lateral (select x.token from public.invoice_links x where x.folder_id = f.id) l on true),
  0::bigint, 'known app: no share link through an embedded select');
select is((select count(*) from public.invoice_links where folder_id = 'c1000000-0000-4000-8000-0000000000f1' and enabled is not null),
  0::bigint, 'known app: the link row (and its enabled flag) is hidden');
select set_config('request.jwt.claims', (select stranger from c), true);
select is((select count(*) from public.invoice_links), 0::bigint, 'unknown app: no share links');
-- A client_id key with a JSON null value still marks an app token: no share links.
select set_config('request.jwt.claims', jsonb_set((select session from c)::jsonb, '{client_id}', 'null')::text, true);
select is((select count(*) from public.invoice_links), 0::bigint, 'JSON-null client_id: no share links');
select set_config('request.jwt.claims', jsonb_set((select session from c)::jsonb, '{client_id}', '""')::text, true);
select is((select count(*) from public.invoice_links), 0::bigint, 'empty client_id: no share links');
select set_config('request.jwt.claims', (select session from c), true);
select is((select count(l.token) from public.invoice_folders f
    left join lateral (select x.token from public.invoice_links x where x.folder_id = f.id) l on true),
  1::bigint, 'session: embedded select still returns the link');

-- The anon role can run the guard (every API request calls it, signed in or not).
reset role;
set local role anon;
select is(pg_temp.guard('{"role":"anon"}', 'GET', '/wallets'), 'allowed read-write', 'anon request without client_id');
select throws_ok('select count(*) from public.connector_clients', '42501', null, 'anon cannot read connector_clients');
reset role;

-- connector_clients: signed-in accounts read it, nobody writes it through the API.
set local role authenticated;
select is((select count(*) from public.connector_clients where client_id = 'c7000000-0000-4000-8000-0000000000a1'), 1::bigint,
  'authenticated can read connector_clients');
select throws_ok($$insert into public.connector_clients(client_id, name) values ('mine', 'Mine')$$, '42501', null,
  'authenticated cannot register an app');
select throws_ok($$update public.connector_clients set name = 'Renamed'$$, '42501', null,
  'authenticated cannot rename an app');
select throws_ok($$delete from public.connector_clients$$, '42501', null, 'authenticated cannot remove an app');
reset role;
select is((select name from public.connector_clients where client_id = 'c7000000-0000-4000-8000-0000000000a1'), 'Claude (test)', 'the app row is unchanged');

select * from finish();
rollback;
