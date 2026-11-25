-- Connected apps may now make the changes the connector's write tools make, and nothing else.
-- 20261209000000_connector_read_only.sql made a registered app's token read-only at the Data API.
-- This replaces public.connector_request_guard() with the same checks (registered app, live
-- session of the same person and app, public schema only, fail closed) and two more allowlists:
--   * write_functions: POST /rpc/<name> for the functions the write tools call;
--   * table_writes: POST / PATCH / DELETE on the tables the write tools change directly, each
--     table with exactly the verbs its tools use.
-- An allowed write runs in an ordinary read-write transaction; reads still run read-only.
-- Everything not listed stays refused for an app token (42501 'connector.forbidden'): every
-- other function, every other table write, PUT, GraphQL, other schemas.
--
-- What this does and does not limit. The app holds a real user token, so it can send an
-- allowed write to the Data API directly, without the tool's input checks. It is then held by
-- what holds a signed-in browser session: RLS (own rows only), table constraints and triggers,
-- and the rules inside each function. Deliberately still closed, because no tool needs them and
-- they move or expose more than a tool does:
--   * direct writes to transactions, wallets' balances and loan / pending-payment tables (money
--     moves only through the functions below, which validate it);
--   * share links and folder membership (rotate_invoice_link, join_invoice_folder, ...), and
--     invoice_links stays hidden from app tokens by the restrictive policy of the earlier migration;
--   * currencies (create / update / disable / delete), wallet settle-and-delete, invoice rows and paying;
--   * connector_clients (no write grant for any API role).
--
-- Before adding a name to either list: read the function body (and what it calls) or the
-- table's policies and triggers, confirm an account can only affect its own rows through it,
-- and add the matching case to supabase/tests/connector_writes.test.sql.
--
-- connector_requests: the retry keys of create tools whose action has no request id of its own
-- (src/lib/mcp/write.ts `once`). One row per (person, requestId): claimed before the change,
-- result recorded after, so a retry with the same id replays the result instead of posting twice.
--
-- After every deploy and every Supabase upgrade run `pnpm connector:smoke`: a read is 200, an
-- allowed write (create_wallet) succeeds, and a write that is not listed (create_currency) is
-- 403 connector.forbidden. The 403 shows the guard runs; if the hook setting is lost, app
-- tokens FAIL OPEN to ordinary-session access.
--
-- Rollback to read-only: re-run the function definition from 20261209000000_connector_read_only.sql
-- (create or replace), `notify pgrst, 'reload config';`, then `drop table public.connector_requests;`.
-- The write tools then fail with "Something went wrong"; remove them from the app in the same release.

create table public.connector_requests (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null,
  tool text not null check (tool ~ '^[a-z]+(_[a-z]+)+$' and length(tool) <= 60),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
comment on table public.connector_requests is
  'Retry keys of connector create tools: one row per person and requestId, with the recorded result. See src/lib/mcp/write.ts.';

alter table public.connector_requests enable row level security;
create policy "Own request keys" on public.connector_requests
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on table public.connector_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.connector_requests to authenticated;
grant select, insert, update, delete on table public.connector_requests to service_role;

create or replace function public.connector_request_guard()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Read functions: unchanged from 20261209000000 (stable, security invoker, single SELECTs).
  read_functions constant text[] := array[
    'month_budgets',
    'month_category_spend',
    'category_spend_between',
    'installment_cycle_summary'
  ];
  -- Write functions, one per line with the tool(s) that call it.
  write_functions constant text[] := array[
    'create_wallet',            -- wallets_create
    'reorder_wallets',          -- wallets_update (position)
    'delete_wallet',            -- wallets_delete (soft delete; refuses nonzero balances and wallets in use)
    'save_transaction',         -- transactions_create, transactions_update, wallets_adjust_balance
    'record_balance_transfer',  -- transactions_create (transfer)
    'set_transaction_deleted',  -- transactions_delete, transactions_restore
    'set_transaction_date',     -- transactions_update (date of a managed row)
    'remove_category',          -- categories_delete (deletes or archives)
    'delete_installment',       -- installments_delete
    'create_loan',              -- loans_create
    'update_loan',              -- loans_update
    'delete_loan',              -- loans_delete (archived or canceled loans only)
    'record_loan_payment',      -- loans_record_payment
    'void_loan_payment',        -- loans_delete_payment (reversible void of the latest payment)
    'create_pending_payment',   -- pending_payments_create
    'update_pending_payment',   -- pending_payments_update, pending_payments_delete
    'record_pending_receipt',   -- pending_payments_record_receipt
    'receive_salary'            -- salary_mark_received
  ];
  -- Direct table writes: table -> the verbs its tools use (insert/upsert = POST, update = PATCH, delete = DELETE).
  table_writes constant jsonb := '{
    "wallets":            ["PATCH"],
    "categories":         ["POST", "PATCH"],
    "budgets":            ["POST"],
    "fixed_expenses":     ["POST", "PATCH", "DELETE"],
    "installments":       ["POST", "PATCH"],
    "profiles":           ["PATCH"],
    "shopping_items":     ["POST", "PATCH", "DELETE"],
    "invoice_folders":    ["POST", "PATCH", "DELETE"],
    "connector_requests": ["POST", "PATCH", "DELETE"]
  }'::jsonb;
  -- wallets: name and kind (wallets_update). categories: categories_create / _update / _restore and the
  -- "Balance correction" category of wallets_adjust_balance. budgets: budgets_set / budgets_delete (an
  -- upsert). fixed_expenses, installments, shopping_items, invoice_folders: their create / update /
  -- delete tools. profiles: salary_update, profile_update. connector_requests: retry keys.
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
  writes boolean := false;
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

  -- The app token's own session must still exist (removing the app deletes it). Only the
  -- canonical lower-case form is accepted; any failure to look is a refusal, never a pass.
  if jsonb_typeof(claims -> 'session_id') = 'string'
     and claims ->> 'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    session_ref := (claims ->> 'session_id')::uuid;
  end if;
  begin
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
        if req_method in ('GET', 'HEAD') then
          allowed := true;
        elsif req_method in ('POST', 'PATCH', 'DELETE')
              and jsonb_typeof(table_writes -> parts[2]) = 'array'
              and (table_writes -> parts[2]) ? req_method then
          allowed := true;
          writes := true;
        end if;
      elsif req_method in ('GET', 'HEAD', 'POST') and parts[2] = any (read_functions) then
        allowed := true;
      elsif req_method = 'POST' and parts[2] = any (write_functions) then
        allowed := true;
        writes := true;
      end if;
    end if;
  end if;

  if not coalesce(allowed, false) then
    raise exception using errcode = '42501', message = 'connector.forbidden';
  end if;

  -- A read stays read-only: Postgres refuses any write it could reach, and a read-only
  -- transaction cannot be switched back. A listed write runs read-write.
  if not writes then
    perform pg_catalog.set_config('transaction_read_only', 'on', true);
  end if;
end;
$$;
comment on function public.connector_request_guard() is
  'Data API pre-request hook: connected apps (client_id claim) may read, and may make only the listed writes. See 20261210000000_connector_writes.sql.';

revoke all on function public.connector_request_guard() from public;
grant execute on function public.connector_request_guard() to anon, authenticated, service_role;

notify pgrst, 'reload config';
