-- Connected apps can only read. A token that Supabase Auth's OAuth server issues
-- to an app is a full user token with a `client_id` claim, so its holder can call
-- the Data API (PostgREST) directly. This guard runs before every Data API request
-- (PostgREST `db_pre_request`, the mechanism Supabase documents in "Securing your
-- API") and decides from the request facts PostgREST sets:
--   * no `client_id` claim (an ordinary sign-in session, anon, service role): allowed, untouched;
--   * a `client_id` that is not in public.connector_clients: refused;
--   * a registered app whose token's `session_id` claim is missing, not a canonical
--     lower-case uuid, or not a live auth.sessions row of this same user (`sub`) and
--     this same app (`oauth_client_id`, which Supabase stores as the public client id)
--     whose `not_after` has not passed: refused. When the person removes
--     the app (Supabase Auth revokeGrant) its session row is deleted, so the app's
--     earlier access token, still validly signed for up to an hour, is refused at once.
--     Only app tokens are looked up; ordinary sessions return before any table access.
--     The lookup runs as the function owner (postgres): if the owner cannot read
--     auth.sessions (a privilege change on a hosted project, say) every app token is
--     refused, so this FAILS CLOSED for apps and never affects ordinary sessions.
--   * a registered app: GET/HEAD on a table or view, or GET/HEAD/POST on one of the
--     read functions listed below; everything else is refused. An allowed request
--     is also switched to a read-only transaction, so Postgres itself rejects any
--     write that a read could reach (for example a computed column).
-- A refusal raises SQLSTATE 42501 'connector.forbidden' (HTTP 403 for a signed-in token).
-- Whenever an app token is present and the guard cannot read a fact it needs
-- (claims, session, method, path, headers), it refuses.
--
-- GraphQL (/graphql/v1) is served through PostgREST as POST /rpc/graphql with
-- Content-Profile: graphql_public, so it passes this guard too and is refused for apps.
-- Realtime and Storage do not go through PostgREST and are not covered here.
--
-- Read functions (Step 2 of the hardening plan). The Phase 1 read tools call
-- exactly these four through the API (budgets/queries.ts via getMonthBudgets and
-- getSpendingSummary; installments/cycle-queries.ts via getCycleSummary). All four
-- are `stable`, `security invoker`, `language sql`, and their bodies are single
-- SELECTs over tables, the security-invoker view reporting_entries and auth.uid().
-- installment_cycle_snapshot is also a plain read, but only the CSV export calls
-- it, not a connector tool, so it is left off.
-- Volatility labels are not trusted on their own (Postgres does not enforce them
-- against called functions), so the guard uses an explicit allowlist, not
-- "functions that are not volatile". Any other function, including stable ones, is refused.
--
-- Reads that hand out a write: invoice_links.token lets any other account join the
-- folder (join_invoice_folder). A restrictive policy hides those rows from app
-- tokens on every path (direct, embedded, Realtime), not just the request path.
--
-- The hook lives in a role setting, not in the schema. If that setting is lost
-- (role reset, a dashboard change, a restore that skips role settings) the guard
-- stops running and app tokens FAIL OPEN to ordinary-session access. After every
-- deploy and every Supabase upgrade run `pnpm connector:smoke` (scripts/connector-smoke.mjs):
-- with a registered app's FRESH token a read (GET /rest/v1/wallets) is 200 and
-- POST /rpc/create_wallet is 403 connector.forbidden. The 403 shows the guard runs; the 200
-- shows its session lookup works (a 403 on the read too means the owner cannot read
-- auth.sessions, or the app's oauth_client_id or the request path differ).
--
-- Rollback (in this order). First stop every app: remove each registered app while the
-- OAuth server is still on (pnpm connector:register --remove <id>), then turn the OAuth
-- server off in the dashboard. Then wait one hour (the access token lifetime): the Data
-- API checks only signature and expiry, so an app token issued in the last hour is
-- read-write once the hook is reset. Then:
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
--   drop policy "Connected apps cannot read share links" on public.invoice_links;
--   drop function public.connector_request_guard();
--   drop table public.connector_clients;

create table public.connector_clients (
  client_id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);
comment on table public.connector_clients is
  'OAuth apps the owner registered for the Claude connector. Written only with the secret key (pnpm connector:register).';

alter table public.connector_clients enable row level security;
create policy "Signed-in accounts can read registered apps" on public.connector_clients
  for select to authenticated using (true);
revoke all on table public.connector_clients from public, anon, authenticated;
grant select on table public.connector_clients to authenticated;
grant select, insert, update, delete on table public.connector_clients to service_role;

-- A share-link token is a credential for adding people to the folder, so app tokens
-- never see it. Restrictive: it narrows the existing owner-only select policy.
-- Any `client_id` key hides the rows, a JSON null one included; no claims at all hides nothing.
create policy "Connected apps cannot read share links" on public.invoice_links
  as restrictive for select to authenticated
  using (not coalesce((select auth.jwt()) ? 'client_id', false));

create function public.connector_request_guard()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- One entry per read function a registered app may call. Before adding one,
  -- read its body (and every function it calls) and confirm it does not write.
  read_functions constant text[] := array[
    'month_budgets',              -- budgets_get, summary_get: latest limit per category and currency (select on budgets)
    'month_category_spend',       -- budgets_get, summary_get: calendar-month spend (select on reporting_entries, categories)
    'category_spend_between',     -- summary_get: salary-cycle spend (select on reporting_entries, categories)
    'installment_cycle_summary'   -- installments_list, salary_status_get: progress this cycle (select on transactions, installments)
  ];
  raw_claims text := current_setting('request.jwt.claims', true);
  raw_headers text := current_setting('request.headers', true);
  req_method text := current_setting('request.method', true);
  req_path text := current_setting('request.path', true);
  claims jsonb;
  headers jsonb;
  client text;
  session_ref uuid;
  live boolean := false;
  parts text[];
  allowed boolean := false;
begin
  -- Outside an API request (direct SQL, tests) there are no claims and nothing to decide.
  if raw_claims is null or raw_claims = '' then
    return;
  end if;

  begin
    claims := raw_claims::jsonb;
  exception when others then
    claims := null;
  end;
  if claims is null or jsonb_typeof(claims) <> 'object' then
    raise exception using errcode = '42501', message = 'connector.forbidden';
  end if;

  -- An ordinary session has no client_id claim.
  if not claims ? 'client_id' then
    return;
  end if;

  if jsonb_typeof(claims -> 'client_id') = 'string' then
    client := claims ->> 'client_id';
  end if;
  if client is null or client = ''
     or not exists (select 1 from public.connector_clients c where c.client_id = client) then
    raise exception using errcode = '42501', message = 'connector.forbidden';
  end if;

  -- The app token's own session must still exist: removing the app (revokeGrant) deletes it,
  -- and the token, a signed JWT, would otherwise keep working until it expires. Only the
  -- canonical lower-case form Supabase Auth issues is accepted. Any failure to look (the owner
  -- cannot read auth.sessions, say) is a refusal, never a pass.
  if jsonb_typeof(claims -> 'session_id') = 'string'
     and claims ->> 'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    session_ref := (claims ->> 'session_id')::uuid;
  end if;
  begin
    -- Tied to the token: the same person and the same app (compared as text, so no cast can
    -- raise), and not past the session's own end.
    live := session_ref is not null and exists (
      select 1 from auth.sessions s
      where s.id = session_ref
        and s.user_id::text = claims ->> 'sub'
        and s.oauth_client_id::text = client
        and (s.not_after is null or s.not_after > now())
    );
  exception when others then
    live := false;
  end;
  if not coalesce(live, false) then
    raise exception using errcode = '42501', message = 'connector.forbidden';
  end if;

  -- Only the default `public` schema: refuse any other profile (graphql_public included).
  -- PostgREST always sets request.headers; missing or unreadable headers are refused.
  begin
    headers := nullif(raw_headers, '')::jsonb;
  exception when others then
    headers := null;
  end;
  if headers is not null and jsonb_typeof(headers) = 'object'
     and coalesce(headers ->> 'accept-profile', 'public') = 'public'
     and coalesce(headers ->> 'content-profile', 'public') = 'public' then
    -- '/name' is a table or view; '/rpc/name' is a function. Nothing else is understood.
    parts := regexp_match(coalesce(req_path, ''), '^/?(rpc/)?([a-z_][a-z0-9_]*)$');
    if parts is not null then
      if parts[1] is null then
        allowed := req_method in ('GET', 'HEAD');
      else
        allowed := req_method in ('GET', 'HEAD', 'POST') and parts[2] = any (read_functions);
      end if;
    end if;
  end if;

  if not coalesce(allowed, false) then
    raise exception using errcode = '42501', message = 'connector.forbidden';
  end if;

  -- Reads only: from here on Postgres refuses any write in this request, and
  -- a read-only transaction cannot be switched back to read-write.
  perform pg_catalog.set_config('transaction_read_only', 'on', true);
end;
$$;
comment on function public.connector_request_guard() is
  'Data API pre-request hook: connected apps (client_id claim) may only read. See 20261209000000_connector_read_only.sql.';

revoke all on function public.connector_request_guard() from public;
grant execute on function public.connector_request_guard() to anon, authenticated, service_role;

-- Register the hook. Refuse to replace a different pre-request function silently.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_db_role_setting s, unnest(s.setconfig) c
    where s.setrole = 'authenticator'::regrole
      and c like 'pgrst.db_pre_request=%'
      and c <> 'pgrst.db_pre_request=public.connector_request_guard'
  ) then
    raise exception 'authenticator already has a different pgrst.db_pre_request; merge it into public.connector_request_guard first';
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'public.connector_request_guard';
notify pgrst, 'reload config';
