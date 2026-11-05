-- One atomic conversion. A balance's UUID is the accounting identity; the
-- original wallet UUID remains the container identity and its first balance ID.
begin;
set local search_path='';
lock table public.wallets, public.transactions, public.cashier_changes,
  public.profiles, public.fixed_expenses, public.installments, public.loans,
  public.pending_payments, public.budgets in access exclusive mode;
do $$ declare r record; begin for r in select c.oid::regclass relation from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop execute format('alter table %s disable trigger user',r.relation); end loop; end $$;
create schema ledger_private;
revoke all on schema ledger_private from public, anon;
grant usage on schema ledger_private to authenticated;

-- Save the incumbent implementations, triggers, views and exact privileges
-- before changing their types. Only the documented identity/type substitutions
-- below are applied; all existing monetary/cycle/replay rules are retained.
create temp table mw_functions on commit drop as
select p.oid, p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition,
  n.nspname, p.proname, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' or n.nspname like '%\_private' escape '\')
  and (p.prosrc ~ '(wallet|currency)' or 'public.currency'::regtype::oid=any(p.proargtypes) or pg_get_function_result(p.oid) like '%public.currency%');
create temp table mw_grants on commit drop as
select f.oid, a.grantee, a.privilege_type, a.is_grantable
from mw_functions f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',(select oid from pg_roles where rolname=current_user)))) a;
create temp table mw_triggers on commit drop as
select t.tgname,t.tgrelid::regclass::text relation,pg_get_triggerdef(t.oid) definition
from pg_trigger t where not t.tgisinternal and t.tgfoid in(select oid from mw_functions);
create temp table mw_views on commit drop as
select c.relname,pg_get_viewdef(c.oid) definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v';
create temp table mw_before on commit drop as select w.id,w.user_id,w.currency::text currency,w.opening_balance_minor,w.position,w.archived_at,w.created_at,b.balance_minor from public.wallets w join public.wallet_balances b on b.wallet_id=w.id;

do $$ declare r record; begin
 for r in select * from mw_triggers loop execute format('drop trigger %I on %s',r.tgname,r.relation); end loop;
 for r in select * from mw_views order by (relname='loan_overview') desc loop execute format('drop view if exists public.%I cascade',r.relname); end loop;
 for r in select * from mw_functions loop execute 'drop function if exists '||r.identity||' cascade'; end loop;
end $$;

create table public.currencies (
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 code text not null check(code ~ '^[A-Z][A-Z0-9]{0,11}$'),
 symbol text not null check(symbol=btrim(symbol) and char_length(symbol) between 1 and 12),
 decimal_places smallint not null check(decimal_places between 0 and 8),
 first_used_at timestamptz, disabled_at timestamptz, created_at timestamptz not null default now(),
 primary key(user_id,code)
);
insert into public.currencies(user_id,code,symbol,decimal_places)
select u.id,d.code,d.symbol,d.precision from auth.users u
cross join(values('USD','$',2),('LBP','LBP',0),('SYP','SYP',0)) d(code,symbol,precision);

-- Convert every physical enum column, including private staging and rate facts.
do $$ declare r record; begin
 for r in select n.nspname,c.relname,a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
 where a.atttypid='public.currency'::regtype and c.relkind='r' and a.attnum>0 and not a.attisdropped loop
  execute format('alter table %I.%I alter column %I type text using %I::text',r.nspname,r.relname,r.attname,r.attname);
 end loop;
end $$;

alter table public.wallets add column default_balance_id uuid, add column deleted_at timestamptz,
 add column needs_attention boolean not null default false, add unique(id,user_id);
create table public.wallet_balances (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 wallet_id uuid not null,
 currency text not null,
 opening_balance_minor bigint not null default 0 check(opening_balance_minor between -1000000000000000 and 1000000000000000),
 position integer not null check(position>=0), detached_at timestamptz,
 created_at timestamptz not null default now(),
 unique(id,user_id), unique(id,wallet_id,user_id), unique(wallet_id,currency),
 foreign key(wallet_id,user_id) references public.wallets(id,user_id) on delete cascade,
 foreign key(user_id,currency) references public.currencies(user_id,code) on update cascade
);
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position,created_at)
select id,user_id,id,currency,opening_balance_minor,0,created_at from public.wallets;
update public.wallets set default_balance_id=id;
-- Unresolved archived wallets remain hidden management-only containers.
update public.wallets w set deleted_at=case when b.balance_minor=0 and not (
 exists(select 1 from public.profiles p where p.salary_wallet_id=w.id)
 or exists(select 1 from public.fixed_expenses f where f.wallet_id=w.id)
 or exists(select 1 from public.installments x where x.wallet_id=w.id and x.total_minor>x.paid_before_minor+coalesce((select sum(t.amount_minor) from public.transactions t where t.installment_id=x.id and t.deleted_at is null),0))
 or exists(select 1 from public.loans l where l.wallet_id=w.id and l.deleted_at is null and l.total_due_minor-l.principal_paid_before_minor-l.fee_paid_before_minor>coalesce((select sum(t.amount_minor) from public.transactions t where t.loan_id=l.id and t.loan_event='repayment' and t.deleted_at is null),0))
) then w.archived_at else null end
from mw_before b where b.id=w.id and w.archived_at is not null;
update public.wallets set needs_attention=archived_at is not null and deleted_at is null;

update public.wallets w set position=x.position from(
 select id,row_number() over(partition by user_id order by position,created_at,id)-1 position
 from public.wallets where deleted_at is null and not needs_attention
)x where x.id=w.id;

-- Legacy columns have the exact initial balance UUID, so renaming is a lossless
-- backfill including soft-deleted transactions and historical change legs.
do $$ declare r record; new_name text; begin
 for r in select conrelid::regclass relation,conname from pg_constraint where contype='f' and confrelid='public.wallets'::regclass and conrelid<>'public.wallet_balances'::regclass loop
  execute format('alter table %s drop constraint %I',r.relation,r.conname);
 end loop;
 for r in select c.relname,a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname not in('wallets','wallet_balances') and a.attname like '%wallet_id%' and not a.attisdropped loop
  new_name:=replace(r.attname,'wallet_id','balance_id');
  execute format('alter table public.%I rename column %I to %I',r.relname,r.attname,new_name);
  if new_name not like '%ids' then
   execute format('alter table public.%I add constraint %I foreign key(%I,user_id) references public.wallet_balances(id,user_id) deferrable initially deferred',r.relname,r.relname||'_'||new_name||'_owner',new_name);
  end if;
 end loop;
end $$;
drop policy if exists wallets_delete on public.wallets;
drop index if exists public.wallets_user_idx;
alter table public.wallets drop column currency, drop column opening_balance_minor, drop column archived_at;
alter table public.wallets alter column default_balance_id set not null;
alter table public.wallets add constraint wallet_default_owner foreign key(default_balance_id,id,user_id)
 references public.wallet_balances(id,wallet_id,user_id) deferrable initially deferred;
create index wallets_user_idx on public.wallets(user_id,position) where deleted_at is null and not needs_attention;

-- This context is read-only. Its id is ALWAYS a balance UUID, never a default
-- chosen by the server. It supplies container metadata to mature ledger rules.
create view ledger_private.balance_context with(security_invoker=true) as
select b.id,b.user_id,w.name,w.kind,b.currency,b.opening_balance_minor,b.position,
 coalesce(w.deleted_at,b.detached_at,case when w.needs_attention then '-infinity'::timestamptz end) archived_at,
 b.created_at,b.wallet_id from public.wallet_balances b join public.wallets w on (w.id,w.user_id)=(b.wallet_id,b.user_id);
grant select,update on ledger_private.balance_context to authenticated;

-- Translate stored replay payloads recursively, retaining every numeric fact.
create function pg_temp.mw_payload(value jsonb) returns jsonb language plpgsql as $$
declare result jsonb; e record; begin
 if jsonb_typeof(value)='object' then
  result:='{}'; for e in select * from jsonb_each(value) loop
   result:=result||jsonb_build_object(replace(e.key,'walletId','balanceId'),pg_temp.mw_payload(e.value)); end loop; return result;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(pg_temp.mw_payload(x.value) order by x.ordinality),'[]') into result from jsonb_array_elements(value) with ordinality x; return result;
 end if; return value;
end $$;
update public.loans set request_payload=pg_temp.mw_payload(request_payload);
update public.transactions set loan_payload=pg_temp.mw_payload(loan_payload),pending_receipt_payload=pg_temp.mw_payload(pending_receipt_payload);

set constraints all immediate;
alter table public.transactions add column wallet_name_snapshot text,add column to_wallet_name_snapshot text;
alter table public.cashier_changes add column wallet_name_snapshot text;
update public.transactions t set wallet_name_snapshot=w.name from ledger_private.balance_context w where w.id=t.balance_id;
update public.transactions t set to_wallet_name_snapshot=w.name from ledger_private.balance_context w where w.id=t.to_balance_id;
update public.cashier_changes c set wallet_name_snapshot=w.name from ledger_private.balance_context w where w.id=c.balance_id;

-- Rebuild the affected implementations from their final installed definitions.
-- Explicit schemas, signatures, ACLs and trigger timing remain unchanged.
do $$ declare r record; d text; ident text; begin
 for r in select * from mw_views where relname<>'wallet_balances' order by (relname='loan_overview'),relname loop
  execute format('create view public.%I with(security_invoker=true) as %s',r.relname,replace(replace(r.definition,'public.currency','text'),'wallet_id','balance_id'));
  execute format('grant select on public.%I to authenticated',r.relname);
 end loop;
 for r in select * from mw_functions where proname not in('delete_wallet','wallets_currency_locked','wallets_cashier_currency_locked','wallets_loan_currency_locked') order by oid loop
  d:=replace(replace(replace(r.definition,'public.currency','text'),'wallet_id','balance_id'),'walletId','balanceId');
  d:=regexp_replace(d,'public\.wallets\M','ledger_private.balance_context','g');
  d:=replace(d,'wallets.id','balance_context.id');
  d:=replace(d,'if not replay and replace_settlement then','if not replay and replace_settlement and requested_snapshot is distinct from existing_snapshot then');
  if r.proname='save_transaction_aggregate_without_cost_currency' then d:=replace(d,E'begin\n',E'begin\n  set constraints public.transactions_cashier_check,public.cashier_changes_valid deferred;\n'); end if;
  execute d;
  ident:=replace(replace(r.identity,'public.currency','text'),'wallet_id','balance_id');
  execute 'revoke all on function '||ident||' from public,anon,authenticated';
  for d in select format('grant %s on function %s to %s%s',g.privilege_type,ident,case when g.grantee=0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end,case when g.is_grantable then ' with grant option' else '' end) from mw_grants g where g.oid=r.oid loop execute d; end loop;
 end loop;
 for r in select * from mw_triggers where relation<>'wallets' and relation<>'public.wallets' loop execute replace(r.definition,'wallet_id','balance_id'); end loop;
end $$;

create view public.wallet_balance_totals with(security_invoker=true) as
select b.id balance_id,b.wallet_id,b.user_id,b.currency,b.opening_balance_minor
 +coalesce((select sum(case when t.kind::text='income' or(t.kind::text='loan' and t.loan_flow='in') then t.amount_minor when t.kind::text='expense' then -coalesce(t.tender_minor,t.amount_minor) else -t.amount_minor end) from public.transactions t where t.balance_id=b.id and t.deleted_at is null),0)
 +coalesce((select sum(t.to_amount_minor) from public.transactions t where t.to_balance_id=b.id and t.kind::text='transfer' and t.deleted_at is null),0)
 +coalesce((select sum(c.amount_minor) from public.cashier_changes c join public.transactions t on (t.id,t.user_id)=(c.transaction_id,c.user_id) where c.balance_id=b.id and t.kind::text='expense' and t.deleted_at is null),0) balance_minor
from public.wallet_balances b;
grant select on public.wallet_balance_totals to authenticated;

-- Catalog ownership applies to every live text currency/rate/cost column.
do $$ declare r record; begin
 for r in select c.relname,a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and a.attname in('currency','cost_currency','change_currency','change_rate_base','change_rate_quote','rate_base','rate_quote') and not a.attisdropped loop
  if r.relname<>'wallet_balances' then execute format('alter table public.%I add foreign key(user_id,%I) references public.currencies(user_id,code) on update cascade',r.relname,r.attname); end if;
  execute format('update public.currencies c set first_used_at=coalesce(c.first_used_at,now()) where exists(select 1 from public.%I x where x.user_id=c.user_id and x.%I=c.code)',r.relname,r.attname);
 end loop;
end $$;
drop type public.currency;

-- Verify all legacy accounting values before any lifecycle trigger is enabled.
do $$ begin
 if exists(select 1 from mw_before old join public.wallet_balance_totals b on b.balance_id=old.id where b.balance_minor is distinct from old.balance_minor) then raise exception 'balance.migrationMismatch'; end if;
end $$;

alter table public.currencies enable row level security;
alter table public.wallet_balances enable row level security;
create policy currencies_owner on public.currencies for all using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy balances_read on public.wallet_balances for select using(user_id=(select auth.uid()));
create policy balances_insert on public.wallet_balances for insert with check(user_id=(select auth.uid()));
create policy balances_update on public.wallet_balances for update using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.currencies,public.wallet_balances from anon;
grant select,insert,update,delete on public.currencies to authenticated;
grant select,insert,update on public.wallet_balances to authenticated;

create function ledger_private.bootstrap_currencies() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.currencies(user_id,code,symbol,decimal_places) values(new.id,'USD','$',2),(new.id,'LBP','LBP',0),(new.id,'SYP','SYP',0); return new; end $$;
create trigger bootstrap_currencies after insert on auth.users for each row execute function ledger_private.bootstrap_currencies();

create function ledger_private.lock_currency_definition(p_user_id uuid,p_code text,p_require_enabled boolean)
returns public.currencies language plpgsql set search_path='' as $$
declare c public.currencies; begin
 perform ledger_private.lock_owner();
 if p_user_id is distinct from auth.uid() and current_user not in('postgres','supabase_admin') then raise exception 'currency.unavailable'; end if;
 select * into c from public.currencies where user_id=p_user_id and code=p_code for update;
 if not found then raise exception 'currency.unavailable'; end if;
 if p_require_enabled and c.disabled_at is not null then raise exception 'currency.disabled'; end if;
 return c;
end $$;
create function ledger_private.lock_wallet_balance(p_user_id uuid,p_balance_id uuid,p_require_active boolean)
returns public.wallet_balances language plpgsql set search_path='' as $$
declare b public.wallet_balances; w public.wallets; begin
 perform ledger_private.lock_owner();
 if p_user_id is distinct from auth.uid() and current_user not in('postgres','supabase_admin') then raise exception 'balance.unavailable'; end if;
 select * into b from public.wallet_balances where id=p_balance_id and user_id=p_user_id;
 if not found then raise exception 'balance.unavailable'; end if;
 perform ledger_private.lock_currency_definition(p_user_id,b.currency,p_require_active);
 select * into w from public.wallets where id=b.wallet_id and user_id=p_user_id for update;
 select * into b from public.wallet_balances where id=p_balance_id and user_id=p_user_id for update;
 if p_require_active then
  if w.deleted_at is not null then raise exception 'wallet.deleted'; end if;
  if w.needs_attention and not ledger_private.resolution_allowed(w.user_id,w.id) then raise exception 'wallet.needsAttention'; end if;
  if b.detached_at is not null then raise exception 'balance.detached'; end if;
 end if;
 return b;
end $$;

create function ledger_private.balance_has_dependency(p_balance uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where salary_balance_id=p_balance)
 or exists(select 1 from public.fixed_expenses where balance_id=p_balance)
 or exists(select 1 from public.installments i join public.installment_progress p on p.installment_id=i.id where i.balance_id=p_balance and p.remaining_minor>0)
 or exists(select 1 from public.loans l join public.loan_progress p on p.id=l.id where l.balance_id=p_balance and l.deleted_at is null and p.remaining_minor>0);
$$;
create function ledger_private.currency_has_dependency(p_owner uuid,p_code text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.wallet_balances b where b.user_id=p_owner and b.currency=p_code and ledger_private.balance_has_dependency(b.id))
 or exists(select 1 from public.pending_payment_progress p where p.user_id=p_owner and p.currency=p_code and p.deleted_at is null and p.remaining_minor>0)
 or exists(select 1 from public.month_budgets(date_trunc('month',current_date)::date) b where b.currency=p_code)
 or exists(select 1 from public.budgets b where b.user_id=p_owner and b.currency=p_code and b.starts_month>date_trunc('month',current_date)::date and b.limit_minor is not null);
$$;

create function ledger_private.currency_guard() returns trigger language plpgsql set search_path='' as $$
declare w public.wallets; alternative uuid; begin
 if tg_op='DELETE' then
  if pg_trigger_depth()>1 then return old; end if;
  if old.first_used_at is not null then raise exception 'currency.used'; end if;
  if old.disabled_at is null and not exists(select 1 from public.currencies where user_id=old.user_id and code<>old.code and disabled_at is null) then raise exception 'currency.lastEnabled'; end if;
  return old;
 end if;
 if tg_op='UPDATE' then
  if (new.user_id,new.created_at) is distinct from (old.user_id,old.created_at) then raise exception 'currency.immutable'; end if;
  if old.first_used_at is not null and (new.code,new.decimal_places,new.first_used_at) is distinct from (old.code,old.decimal_places,old.first_used_at) then raise exception 'currency.used'; end if;
  if old.disabled_at is null and new.disabled_at is not null then
   if not exists(select 1 from public.currencies c where c.user_id=new.user_id and c.code<>new.code and c.disabled_at is null) then raise exception 'currency.lastEnabled'; end if;
   if exists(select 1 from public.wallet_balance_totals b where b.user_id=new.user_id and b.currency=new.code and b.balance_minor<>0) then raise exception 'currency.nonzero'; end if;
   if ledger_private.currency_has_dependency(new.user_id,new.code) then raise exception 'currency.inUse'; end if;
   for w in select x.* from public.wallets x join public.wallet_balances b on b.id=x.default_balance_id where x.user_id=new.user_id and x.deleted_at is null and b.currency=new.code order by x.id for update of x loop
    select b.id into alternative from public.wallet_balances b join public.currencies c on(c.user_id,c.code)=(b.user_id,b.currency)
    where b.wallet_id=w.id and b.detached_at is null and c.disabled_at is null and c.code<>new.code
    order by (b.position>(select position from public.wallet_balances where id=w.default_balance_id)) desc,b.position,b.id limit 1;
    if alternative is null then raise exception 'currency.lastBalance'; end if;
    update public.wallets set default_balance_id=alternative where id=w.id;
   end loop;
  end if;
 end if;
 return new;
end $$;
create trigger currency_guard before update or delete on public.currencies for each row execute function ledger_private.currency_guard();

create function ledger_private.wallet_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  select coalesce(max(position),-1)+1 into new.position from public.wallets where user_id=new.user_id and deleted_at is null and not needs_attention;
 elsif tg_op='UPDATE' then
  if (new.id,new.user_id,new.created_at) is distinct from(old.id,old.user_id,old.created_at) then raise exception 'wallet.immutable'; end if;
  if old.deleted_at is not null and new is distinct from old then raise exception 'wallet.deleted'; end if;
  if old.needs_attention and not new.needs_attention and new.deleted_at is null then raise exception 'wallet.needsAttention'; end if;
  if old.deleted_at is null and new.deleted_at is not null then
   if exists(select 1 from public.wallet_balance_totals where wallet_id=new.id and balance_minor<>0) then raise exception 'wallet.nonzero'; end if;
   if exists(select 1 from public.wallet_balances where wallet_id=new.id and ledger_private.balance_has_dependency(id)) then raise exception 'wallet.inUse'; end if;
   new.needs_attention:=false;
  end if;
 end if;
 return new;
end $$;
create trigger wallet_guard before insert or update on public.wallets for each row execute function ledger_private.wallet_guard();

create function ledger_private.default_guard() returns trigger language plpgsql set search_path='' as $$
declare target uuid; begin
 if tg_table_name='wallets' then target:=new.id; else target:=new.wallet_id; end if;
 if exists(select 1 from public.wallets w where w.id=target and w.deleted_at is null and not exists(
  select 1 from public.wallet_balances b join public.currencies c on(c.user_id,c.code)=(b.user_id,b.currency)
  where b.id=w.default_balance_id and b.wallet_id=w.id and b.user_id=w.user_id and b.detached_at is null and c.disabled_at is null
 )) then raise exception 'wallet.invalidDefault'; end if;
 return null;
end $$;
create constraint trigger wallet_default_guard after insert or update on public.wallets deferrable initially deferred for each row execute function ledger_private.default_guard();
create constraint trigger balance_default_guard after insert or update on public.wallet_balances deferrable initially deferred for each row execute function ledger_private.default_guard();

create function ledger_private.balance_guard() returns trigger language plpgsql set search_path='' as $$
declare w public.wallets; active boolean; begin
 active:=tg_op='INSERT' or (old.detached_at is not null and new.detached_at is null);
 perform ledger_private.lock_currency_definition(new.user_id,new.currency,active);
 select * into w from public.wallets where id=new.wallet_id and user_id=new.user_id for update;
 if not found then raise exception 'wallet.unavailable'; end if;
 if w.deleted_at is not null then raise exception 'wallet.deleted'; end if;
 if active and w.needs_attention then raise exception 'wallet.needsAttention'; end if;
 if tg_op='UPDATE' then
  if (new.id,new.user_id,new.wallet_id,new.currency,new.opening_balance_minor,new.position,new.created_at) is distinct from(old.id,old.user_id,old.wallet_id,old.currency,old.opening_balance_minor,old.position,old.created_at) then raise exception 'balance.immutable'; end if;
  if old.detached_at is null and new.detached_at is not null then
   if (select balance_minor from public.wallet_balance_totals where balance_id=new.id)<>0 then raise exception 'balance.nonzero'; end if;
   if ledger_private.balance_has_dependency(new.id) then raise exception 'balance.inUse'; end if;
   if w.default_balance_id=new.id then raise exception 'wallet.invalidDefault'; end if;
  end if;
 else
  select coalesce(max(position),-1)+1 into new.position from public.wallet_balances where wallet_id=new.wallet_id;
 end if;
 update public.currencies set first_used_at=coalesce(first_used_at,now()) where user_id=new.user_id and code=new.currency;
 return new;
end $$;
create trigger balance_guard before insert or update on public.wallet_balances for each row execute function ledger_private.balance_guard();

-- Defense in depth for direct DML as well as every specialized RPC. Metadata
-- edits leave financial legs unchanged; all monetary mutations check old+new IDs.
create function ledger_private.monetary_guard() returns trigger language plpgsql set search_path='' as $$
declare old_data jsonb; new_data jsonb; ids uuid[]:='{}'; codes text[]:='{}'; k text; b public.wallet_balances; changed boolean; item record;
begin
 if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
 if tg_op='DELETE' then new_data:=to_jsonb(old); else new_data:=to_jsonb(new); end if;
 if tg_op='UPDATE' then old_data:=to_jsonb(old); end if;
 changed:=tg_op<>'UPDATE' or (select jsonb_object_agg(key,value) from jsonb_each(new_data) where key=any(array['user_id','balance_id','to_balance_id','change_balance_ids','salary_balance_id','salary_amount_minor','amount_minor','to_amount_minor','tender_minor','kind','loan_flow','currency','cost_currency','rate_base','rate_quote','rate_numerator','rate_denominator','deleted_at','total_minor','paid_before_minor','starts_month','monthly_minor','principal_minor','fee_minor','limit_minor'])) is distinct from (select jsonb_object_agg(key,value) from jsonb_each(old_data) where key=any(array['user_id','balance_id','to_balance_id','change_balance_ids','salary_balance_id','salary_amount_minor','amount_minor','to_amount_minor','tender_minor','kind','loan_flow','currency','cost_currency','rate_base','rate_quote','rate_numerator','rate_denominator','deleted_at','total_minor','paid_before_minor','starts_month','monthly_minor','principal_minor','fee_minor','limit_minor']));
 -- A budget category determines which later versions supersede its limit;
 -- transaction category corrections remain metadata-only ledger changes.
 if tg_table_name='budgets' then
  changed:=changed or (new_data->'category_id') is distinct from (old_data->'category_id');
 end if;
 if not changed then return new; end if;
 for k in select jsonb_object_keys(new_data) loop
  if k in('balance_id','to_balance_id','change_balance_id','salary_balance_id') then
   ids:=ids||array[(new_data->>k)::uuid];
   if tg_table_name in('transactions','cashier_changes') then ids:=ids||array[(old_data->>k)::uuid]; end if;
  elsif k='change_balance_ids' then
   select ids||coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(new_data->k,'[]'));
   select ids||coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(old_data->k,'[]'));
  elsif k in('currency','cost_currency','change_currency','rate_base','rate_quote','change_rate_base','change_rate_quote') then
   codes:=codes||array[new_data->>k,old_data->>k];
  end if;
 end loop;
 perform c.code from public.currencies c where c.user_id=(new_data->>'user_id')::uuid and
 (c.code=any(codes) or exists(select 1 from public.wallet_balances locked_balance where locked_balance.id=any(ids) and locked_balance.user_id=c.user_id and locked_balance.currency=c.code)) order by c.code for update;
 perform w.id from public.wallets w where w.user_id=(new_data->>'user_id')::uuid and exists(select 1 from public.wallet_balances locked_balance where locked_balance.id=any(ids) and locked_balance.wallet_id=w.id) order by w.id for update;
 perform locked_balance.id from public.wallet_balances locked_balance where locked_balance.user_id=(new_data->>'user_id')::uuid and locked_balance.id=any(ids) order by locked_balance.id for update;
 -- A disabled or detached historical balance cannot be made nonzero by Undo.
 for item in select distinct x from unnest(ids) x where x is not null order by x loop
  b:=ledger_private.lock_wallet_balance((new_data->>'user_id')::uuid,item.x,tg_op<>'DELETE');
  if exists(select 1 from public.wallets where id=b.wallet_id and deleted_at is not null) then raise exception 'wallet.deleted'; end if;
  if tg_op='DELETE' and exists(select 1 from public.currencies where user_id=b.user_id and code=b.currency and disabled_at is not null) then raise exception 'currency.disabled'; end if;
 end loop;
 for k in select distinct x from unnest(codes) x where x is not null order by x loop
  perform ledger_private.lock_currency_definition((new_data->>'user_id')::uuid,k,tg_op<>'DELETE');
  update public.currencies set first_used_at=coalesce(first_used_at,now()) where user_id=(new_data->>'user_id')::uuid and code=k;
 end loop;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
do $$ declare t text; begin foreach t in array array['transactions','cashier_changes','fixed_expenses','installments','loans','pending_payments','budgets','profiles'] loop
 execute format('create trigger ab_monetary_guard before insert or update or delete on public.%I for each row execute function ledger_private.monetary_guard()',t); end loop; end $$;

create function public.create_wallet(p_name text,p_kind public.wallet_kind,p_currency text,p_opening_minor bigint default 0)
returns uuid language plpgsql set search_path='' as $$
declare w uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); begin
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.wallet_order_guard deferred;
 perform ledger_private.lock_currency_definition(auth.uid(),p_currency,true);
 insert into public.wallets(id,name,kind,default_balance_id) values(w,p_name,p_kind,b);
 insert into public.wallet_balances(id,wallet_id,currency,opening_balance_minor,position) values(b,w,p_currency,p_opening_minor,0);
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.wallet_order_guard immediate;
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.wallet_order_guard deferred;
 return w;
end $$;
create function public.add_wallet_balance(p_wallet_id uuid,p_currency text) returns uuid language plpgsql set search_path='' as $$
declare b uuid; begin
 perform ledger_private.lock_currency_definition(auth.uid(),p_currency,true);
 perform 1 from public.wallets where id=p_wallet_id and user_id=auth.uid() for update;
 if not found then raise exception 'wallet.unavailable'; end if;
 select id into b from public.wallet_balances where wallet_id=p_wallet_id and currency=p_currency;
 if found then update public.wallet_balances set detached_at=null where id=b; return b; end if;
 insert into public.wallet_balances(wallet_id,currency,position) values(p_wallet_id,p_currency,0) returning id into b; return b;
end $$;
create function public.set_wallet_default(p_wallet_id uuid,p_balance_id uuid) returns void language plpgsql set search_path='' as $$
declare b public.wallet_balances; begin
 b:=ledger_private.lock_wallet_balance(auth.uid(),p_balance_id,true);
 if b.wallet_id<>p_wallet_id then raise exception 'wallet.invalidDefault'; end if;
 update public.wallets set default_balance_id=b.id where id=p_wallet_id and user_id=auth.uid();
end $$;
create function public.detach_wallet_balance(p_balance_id uuid) returns void language plpgsql set search_path='' as $$
begin perform ledger_private.lock_wallet_balance(auth.uid(),p_balance_id,false);
 update public.wallet_balances set detached_at=now() where id=p_balance_id and user_id=auth.uid(); end $$;
create function public.set_currency_disabled(p_code text,p_disabled boolean) returns void language plpgsql set search_path='' as $$
begin perform ledger_private.lock_currency_definition(auth.uid(),p_code,false);
 update public.currencies set disabled_at=case when p_disabled then now() else null end where user_id=auth.uid() and code=p_code; end $$;

create function public.record_balance_transfer(p_occurred_on date,p_from_balance_id uuid,p_to_balance_id uuid,p_from_amount_minor bigint,p_to_amount_minor bigint,p_note text default null,p_usd_lbp_rate integer default null)
returns table(id uuid,revision integer) language plpgsql set search_path='' as $$
declare b public.wallet_balances; source_code text; dest_code text; begin
 if p_from_balance_id=p_to_balance_id then raise exception using errcode='22023',message='balance.same'; end if;
 b:=ledger_private.lock_wallet_balance(auth.uid(),p_from_balance_id,true); source_code:=b.currency;
 b:=ledger_private.lock_wallet_balance(auth.uid(),p_to_balance_id,true); dest_code:=b.currency;
 if source_code=dest_code and p_from_amount_minor<>p_to_amount_minor then raise exception using errcode='22023',message='balance.amountMismatch'; end if;
 return query select * from public.record_transfer(p_occurred_on,p_from_balance_id,p_to_balance_id,p_from_amount_minor,p_to_amount_minor,p_note,p_usd_lbp_rate);
end $$;

create function public.reorder_wallets(p_ids uuid[]) returns void language plpgsql set search_path='' as $$
begin
 if p_ids is null or array_position(p_ids,null) is not null or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) x(id))
 or cardinality(p_ids)<>(select count(*) from public.wallets where user_id=auth.uid() and deleted_at is null and not needs_attention)
 or exists(select 1 from unnest(p_ids) x(id) where not exists(select 1 from public.wallets w where w.id=x.id and w.user_id=auth.uid() and w.deleted_at is null and not w.needs_attention)) then raise exception 'wallet.reorderConflict'; end if;
 update public.wallets w set position=x.ordinality-1 from unnest(p_ids) with ordinality x(id,ordinality) where w.id=x.id and w.user_id=auth.uid();
end $$;
create function public.delete_wallet(p_id uuid) returns void language plpgsql set search_path='' as $$
begin
 set constraints public.wallet_order_guard deferred;
 update public.wallets set deleted_at=now() where id=p_id and user_id=auth.uid() and deleted_at is null;
 if not found then raise exception 'wallet.unavailable'; end if;
 update public.wallets w set position=x.position from(select id,row_number() over(order by position,id)-1 position from public.wallets where user_id=auth.uid() and deleted_at is null and not needs_attention)x where w.id=x.id;
 set constraints public.wallet_order_guard immediate;
 set constraints public.wallet_order_guard deferred;
end $$;

-- Functions live in a non-exposed schema; callers need EXECUTE only for nested
-- invoker checks. Trigger entry points are not callable through the public API.
revoke all on all functions in schema ledger_private from public,anon;
grant execute on all functions in schema ledger_private to authenticated;
revoke all on function public.create_wallet(text,public.wallet_kind,text,bigint),public.add_wallet_balance(uuid,text),public.set_wallet_default(uuid,uuid),public.detach_wallet_balance(uuid),public.set_currency_disabled(text,boolean),public.record_balance_transfer(date,uuid,uuid,bigint,bigint,text,integer),public.reorder_wallets(uuid[]),public.delete_wallet(uuid) from public,anon;
grant execute on function public.create_wallet(text,public.wallet_kind,text,bigint),public.add_wallet_balance(uuid,text),public.set_wallet_default(uuid,uuid),public.detach_wallet_balance(uuid),public.set_currency_disabled(text,boolean),public.record_balance_transfer(date,uuid,uuid,bigint,bigint,text,integer),public.reorder_wallets(uuid[]),public.delete_wallet(uuid) to authenticated;
do $$ declare r record; begin for r in select c.oid::regclass relation from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop execute format('alter table %s enable trigger user',r.relation); end loop; end $$;
create table ledger_private.resolutions(user_id uuid not null,wallet_id uuid not null,transaction_id bigint not null,primary key(user_id,wallet_id,transaction_id));
create table ledger_private.deletion_receipts(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,payload jsonb not null,primary key(user_id,request_id));
revoke all on ledger_private.resolutions,ledger_private.deletion_receipts from public,anon,authenticated;
create function ledger_private.resolution_allowed(p_owner uuid,p_wallet uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_owner=auth.uid() and exists(select 1 from ledger_private.resolutions where user_id=p_owner and wallet_id=p_wallet and transaction_id=txid_current());
$$;
revoke all on function ledger_private.resolution_allowed(uuid,uuid) from public,anon;
grant execute on function ledger_private.resolution_allowed(uuid,uuid) to authenticated;
create or replace view ledger_private.balance_context with(security_invoker=true) as
select b.id,b.user_id,w.name,w.kind,b.currency,b.opening_balance_minor,b.position,
 coalesce(w.deleted_at,b.detached_at,case when w.needs_attention and not ledger_private.resolution_allowed(w.user_id,w.id) then '-infinity'::timestamptz end) archived_at,
 b.created_at,b.wallet_id from public.wallet_balances b join public.wallets w on (w.id,w.user_id)=(b.wallet_id,b.user_id);

create function public.settle_and_delete_wallet(p_request_id uuid,p_wallet_id uuid,p_settlements jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); payload jsonb:=jsonb_build_object('walletId',p_wallet_id,'settlements',p_settlements);
 receipt jsonb; entry jsonb; b public.wallet_balances; other public.wallet_balances; amount numeric; chunk bigint; direction integer; count_expected integer;
begin
 if owner_id is null or p_request_id is null or p_wallet_id is null or jsonb_typeof(p_settlements) is distinct from 'array' then raise exception 'wallet.invalidSettlement'; end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet-deletion:'||owner_id::text||':'||p_request_id::text,0));
 select r.payload into receipt from ledger_private.deletion_receipts r where r.user_id=owner_id and r.request_id=p_request_id;
 if found then if receipt is distinct from payload then raise exception 'wallet.deletionConflict'; end if; return; end if;
 perform 1 from public.wallets where id=p_wallet_id and user_id=owner_id and deleted_at is null for update;
 if not found then raise exception 'wallet.unavailable'; end if;
 insert into ledger_private.resolutions values(owner_id,p_wallet_id,txid_current());
 select count(*) into count_expected from public.wallet_balance_totals where wallet_id=p_wallet_id and balance_minor<>0;
 if jsonb_array_length(p_settlements)<>count_expected or (select count(distinct value->>'balanceId') from jsonb_array_elements(p_settlements))<>count_expected then raise exception 'wallet.invalidSettlement'; end if;
 for entry in select value from jsonb_array_elements(p_settlements) order by value->>'balanceId' loop
  if jsonb_typeof(entry)<>'object' or entry-array['balanceId','counterpartBalanceId']<>'{}' or not(entry ?& array['balanceId','counterpartBalanceId']) then raise exception 'wallet.invalidSettlement'; end if;
  b:=ledger_private.lock_wallet_balance(owner_id,(entry->>'balanceId')::uuid,true);
  other:=ledger_private.lock_wallet_balance(owner_id,(entry->>'counterpartBalanceId')::uuid,true);
  if b.wallet_id<>p_wallet_id or other.wallet_id=p_wallet_id or b.currency<>other.currency then raise exception 'wallet.invalidSettlement'; end if;
  select balance_minor into amount from public.wallet_balance_totals where balance_id=b.id;
  if amount=0 then raise exception 'wallet.invalidSettlement'; end if;
  direction:=case when amount>0 then 1 else -1 end;
  amount:=abs(amount);
  while amount>0 loop
   chunk:=least(amount,1000000000000000)::bigint;
   if direction>0 then perform public.record_balance_transfer(public.loan_today(),b.id,other.id,chunk,chunk,'Wallet settlement');
   else perform public.record_balance_transfer(public.loan_today(),other.id,b.id,chunk,chunk,'Wallet settlement'); end if;
   amount:=amount-chunk;
  end loop;
 end loop;
 perform public.delete_wallet(p_wallet_id);
 insert into ledger_private.deletion_receipts values(owner_id,p_request_id,payload);
 delete from ledger_private.resolutions where user_id=owner_id and wallet_id=p_wallet_id and transaction_id=txid_current();
end $$;
revoke all on function public.settle_and_delete_wallet(uuid,uuid,jsonb) from public,anon;
grant execute on function public.settle_and_delete_wallet(uuid,uuid,jsonb) to authenticated;

-- One owner/profile lock precedes all ledger row locks. Direct DML acquires it
-- at statement start; RPCs acquire it before touching loans, transactions or
-- catalogues. Disjoint owners remain independent and PostgreSQL handles waits.
create function ledger_private.lock_owner() returns void language plpgsql set search_path='' as $$
begin if auth.uid() is not null then perform 1 from public.profiles where user_id=auth.uid() for update; end if; end $$;
create function ledger_private.owner_write_lock() returns trigger language plpgsql set search_path='' as $$
begin perform ledger_private.lock_owner(); return null; end $$;
revoke all on function ledger_private.lock_owner(),ledger_private.owner_write_lock() from public,anon;
grant execute on function ledger_private.lock_owner(),ledger_private.owner_write_lock() to authenticated;
do $$ declare r record; d text; begin
 for r in select c.oid::regclass relation from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
  execute format('create trigger a00_owner_write_lock before insert or update or delete on %s for each statement execute function ledger_private.owner_write_lock()',r.relation);
 end loop;
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where (n.nspname='public' or n.nspname in('transaction_private','cashier_private','cycle_private'))
 and l.lanname='plpgsql' and p.prorettype<>'trigger'::regtype and p.provolatile='v' loop
  d:=pg_get_functiondef(r.oid);
  d:=regexp_replace(d,E'\nbegin\\M',E'\nbegin\n  perform ledger_private.lock_owner();','i');
  execute d;
 end loop;
end $$;

create function ledger_private.snapshot_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or new.balance_id is distinct from old.balance_id then
  select w.name into new.wallet_name_snapshot from ledger_private.balance_context w where w.id=new.balance_id and w.user_id=new.user_id;
 elsif new.wallet_name_snapshot is distinct from old.wallet_name_snapshot then raise exception 'wallet.snapshotImmutable'; end if;
 if tg_table_name='transactions' then
  if tg_op='INSERT' or new.to_balance_id is distinct from old.to_balance_id then
   select w.name into new.to_wallet_name_snapshot from ledger_private.balance_context w where w.id=new.to_balance_id and w.user_id=new.user_id;
  elsif new.to_wallet_name_snapshot is distinct from old.to_wallet_name_snapshot then raise exception 'wallet.snapshotImmutable'; end if;
 end if;
 return new;
end $$;
revoke all on function ledger_private.snapshot_guard() from public,anon;
grant execute on function ledger_private.snapshot_guard() to authenticated;
create trigger ac_snapshot_guard before insert or update on public.transactions for each row execute function ledger_private.snapshot_guard();
create trigger ac_snapshot_guard before insert or update on public.cashier_changes for each row execute function ledger_private.snapshot_guard();

-- The database also guards direct writes; a valid reorder/delete RPC may pass
-- through intermediate positions, but its final owner order must be dense.
create function ledger_private.wallet_order_guard() returns trigger language plpgsql set search_path='' as $$
declare n bigint; distinct_n bigint; lo integer; hi integer; begin
 select count(*),count(distinct position),min(position),max(position) into n,distinct_n,lo,hi
 from public.wallets where user_id=new.user_id and deleted_at is null and not needs_attention;
 if n>0 and (n<>distinct_n or lo<>0 or hi<>n-1) then raise exception 'wallet.reorderConflict'; end if;
 return null;
end $$;
revoke all on function ledger_private.wallet_order_guard() from public,anon;
grant execute on function ledger_private.wallet_order_guard() to authenticated;
create constraint trigger wallet_order_guard after insert or update on public.wallets deferrable initially deferred for each row execute function ledger_private.wallet_order_guard();

-- Deletion can reveal an older budget even though it removes a row. Check
-- the resulting statement state, allowing deletion of harmless superseded
-- history (and complete cleanup) while rejecting reactivated dependencies.
create function ledger_private.budget_disabled_dependency_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.currencies c
   where c.user_id=old.user_id and c.code=old.currency and c.disabled_at is not null) then
  return null;
 end if;
 if exists(
   select 1 from (
    select distinct on(b.category_id) b.limit_minor from public.budgets b
    where b.user_id=old.user_id and b.currency=old.currency
      and b.starts_month<=date_trunc('month',current_date)::date
    order by b.category_id,b.starts_month desc
   ) latest where latest.limit_minor is not null
  ) or exists(select 1 from public.budgets b
    where b.user_id=old.user_id and b.currency=old.currency and b.limit_minor is not null
      and b.starts_month>date_trunc('month',current_date)::date) then
  raise exception 'currency.disabled';
 end if;
 return null;
end $$;
revoke all on function ledger_private.budget_disabled_dependency_guard() from public,anon,authenticated;
create trigger zz_budget_disabled_dependency after delete on public.budgets
 for each row execute function ledger_private.budget_disabled_dependency_guard();

commit;
