-- Forward-only upgrade: global catalog coverage, stable exact balance IDs.
begin;
set local search_path='';
lock table public.profiles,public.currencies,public.wallets,public.wallet_balances in access exclusive mode;

-- Only lifecycle RPCs may grant this transaction-scoped internal capability.
-- It also permits zero-row maintenance for Needs-attention containers.
create table ledger_private.currency_operations (
 user_id uuid not null, transaction_id bigint not null,
 primary key(user_id,transaction_id)
);
revoke all on ledger_private.currency_operations from public,anon,authenticated;
create function ledger_private.currency_operation_allowed(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from ledger_private.currency_operations where user_id=p_owner and transaction_id=txid_current());
$$;
revoke all on function ledger_private.currency_operation_allowed(uuid) from public,anon;
grant execute on function ledger_private.currency_operation_allowed(uuid) to authenticated;

-- A deleted, structurally empty tombstone may no longer have any balance after
-- unused-currency cleanup. Live defaults remain mandatory in default_guard.
alter table public.wallets alter column default_balance_id drop not null;

create or replace function ledger_private.currency_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
  if pg_trigger_depth()>1 then return old; end if; -- auth.users cascade
  if not ledger_private.currency_operation_allowed(old.user_id) then raise exception 'currency.lifecycleRequired'; end if;
  if old.first_used_at is not null then raise exception 'currency.used'; end if;
  if old.disabled_at is null and not exists(select 1 from public.currencies where user_id=old.user_id and code<>old.code and disabled_at is null) then raise exception 'currency.lastEnabled'; end if;
  return old;
 end if;
 if (new.user_id,new.created_at) is distinct from (old.user_id,old.created_at) then raise exception 'currency.immutable'; end if;
 if old.first_used_at is not null and (new.code,new.decimal_places,new.first_used_at) is distinct from (old.code,old.decimal_places,old.first_used_at) then raise exception 'currency.used'; end if;
 if new.first_used_at is distinct from old.first_used_at and pg_trigger_depth()<2 then raise exception 'currency.used'; end if;
 if (new.code,new.decimal_places,new.disabled_at) is distinct from (old.code,old.decimal_places,old.disabled_at)
 and not ledger_private.currency_operation_allowed(new.user_id) then raise exception 'currency.lifecycleRequired'; end if;
 return new;
end $$;

create or replace function ledger_private.balance_guard() returns trigger language plpgsql set search_path='' as $$
declare w public.wallets; internal boolean; c public.currencies;
begin
 internal:=ledger_private.currency_operation_allowed(new.user_id);
 c:=ledger_private.lock_currency_definition(new.user_id,new.currency,tg_op='INSERT');
 select * into w from public.wallets where id=new.wallet_id and user_id=new.user_id for update;
 if not found then raise exception 'wallet.unavailable'; end if;
 if w.deleted_at is not null and not internal then raise exception 'wallet.deleted'; end if;
 if tg_op='INSERT' and w.deleted_at is not null then raise exception 'wallet.deleted'; end if;
 if tg_op='INSERT' and w.needs_attention and not internal then raise exception 'wallet.needsAttention'; end if;
 if new.detached_at is not null and c.disabled_at is null then raise exception 'balance.globalCurrency'; end if;
 if tg_op='UPDATE' then
  if (new.id,new.user_id,new.wallet_id,new.opening_balance_minor,new.created_at) is distinct from(old.id,old.user_id,old.wallet_id,old.opening_balance_minor,old.created_at)
   or ((new.currency,new.position,new.detached_at) is distinct from(old.currency,old.position,old.detached_at) and not internal)
  then raise exception 'balance.immutable'; end if;
 else
  select count(*)::integer into new.position from public.currencies x where x.user_id=new.user_id and (x.created_at,x.code)<(c.created_at,c.code);
  if new.opening_balance_minor<>0 then
   update public.currencies set first_used_at=coalesce(first_used_at,now()) where user_id=new.user_id and code=new.currency;
  end if;
 end if;
 return new;
end $$;

-- Preserve the mature monetary validation, adding first use for balance-only
-- references (notably salary and fixed expenses, which carry no currency field).
do $$ declare d text; begin
 d:=pg_get_functiondef('ledger_private.monetary_guard()'::regprocedure);
 d:=replace(d,'b:=ledger_private.lock_wallet_balance((new_data->>''user_id'')::uuid,item.x,tg_op<>''DELETE'');',
 'b:=ledger_private.lock_wallet_balance((new_data->>''user_id'')::uuid,item.x,tg_op<>''DELETE'');
  update public.currencies set first_used_at=coalesce(first_used_at,now()) where user_id=b.user_id and code=b.currency;');
 execute d;
end $$;

-- A null tombstone default is created only while deleting its sole unused
-- balance. Ordinary tombstoning preserves the default, even for zero totals.
create or replace function ledger_private.wallet_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.deleted_at is not null and new.default_balance_id is null
 and (tg_op='INSERT' or old.default_balance_id is distinct from new.default_balance_id or old.deleted_at is distinct from new.deleted_at) then
  if tg_op<>'UPDATE' or old.deleted_at is null or not ledger_private.currency_operation_allowed(new.user_id) then
   raise exception 'wallet.invalidDefault';
  end if;
 end if;
 if tg_op='INSERT' then
  select coalesce(max(position),-1)+1 into new.position from public.wallets where user_id=new.user_id and deleted_at is null and not needs_attention;
 elsif tg_op='UPDATE' then
  if (new.id,new.user_id,new.created_at) is distinct from(old.id,old.user_id,old.created_at) then raise exception 'wallet.immutable'; end if;
  if old.deleted_at is not null and new is distinct from old then
   if not ledger_private.currency_operation_allowed(new.user_id)
    or (to_jsonb(new)-'default_balance_id') is distinct from (to_jsonb(old)-'default_balance_id')
   then raise exception 'wallet.deleted'; end if;
  end if;
  if old.needs_attention and not new.needs_attention and new.deleted_at is null then raise exception 'wallet.needsAttention'; end if;
  if old.deleted_at is null and new.deleted_at is not null then
   if exists(select 1 from public.wallet_balance_totals where wallet_id=new.id and balance_minor<>0) then raise exception 'wallet.nonzero'; end if;
   if exists(select 1 from public.wallet_balances where wallet_id=new.id and ledger_private.balance_has_dependency(id)) then raise exception 'wallet.inUse'; end if;
   new.needs_attention:=false;
  end if;
 end if;
 return new;
end $$;

create function ledger_private.lock_global_catalog() returns uuid language plpgsql set search_path='' as $$
declare owner_id uuid:=auth.uid(); begin
 if owner_id is null then raise exception 'currency.unavailable'; end if;
 perform ledger_private.lock_owner();
 perform code from public.currencies where user_id=owner_id order by code for update;
 perform id from public.wallets where user_id=owner_id order by id for update;
 perform id from public.wallet_balances where user_id=owner_id order by id for update;
 return owner_id;
end $$;
revoke all on function ledger_private.lock_global_catalog() from public,anon,authenticated;

create function ledger_private.sync_global_balances(p_owner uuid) returns void language plpgsql set search_path='' as $$
begin
 insert into public.wallet_balances(user_id,wallet_id,currency,position)
 select p_owner,w.id,c.code,0 from public.wallets w cross join public.currencies c
 where w.user_id=p_owner and c.user_id=p_owner and w.deleted_at is null and c.disabled_at is null
 and not exists(select 1 from public.wallet_balances b where b.wallet_id=w.id and b.currency=c.code)
 order by w.id,c.created_at,c.code;
 update public.wallet_balances b set detached_at=case when c.disabled_at is null then null else b.detached_at end,position=c.position
 from (select code,disabled_at,(row_number() over(order by created_at,code)-1)::integer position from public.currencies where user_id=p_owner)c,
 public.wallets w where b.user_id=p_owner and b.currency=c.code and w.id=b.wallet_id and w.deleted_at is null
 and (b.position is distinct from c.position or (c.disabled_at is null and b.detached_at is not null));
end $$;
revoke all on function ledger_private.sync_global_balances(uuid) from public,anon,authenticated;

create function ledger_private.switch_currency_defaults(p_owner uuid,p_code text) returns void language plpgsql set search_path='' as $$
declare w public.wallets; alternative uuid; current_created timestamptz;
begin
 select created_at into current_created from public.currencies where user_id=p_owner and code=p_code;
 for w in select x.* from public.wallets x join public.wallet_balances b on b.id=x.default_balance_id
 where x.user_id=p_owner and b.currency=p_code order by x.id loop
  select b.id into alternative from public.wallet_balances b join public.currencies c on(c.user_id,c.code)=(b.user_id,b.currency)
  where b.wallet_id=w.id and c.code<>p_code and (w.deleted_at is not null or (c.disabled_at is null and b.detached_at is null))
  order by ((c.created_at,c.code)>(current_created,p_code)) desc,c.created_at,c.code limit 1;
  if w.deleted_at is null and alternative is null then raise exception 'currency.lastBalance'; end if;
  update public.wallets set default_balance_id=alternative where id=w.id;
 end loop;
end $$;
revoke all on function ledger_private.switch_currency_defaults(uuid,text) from public,anon,authenticated;

create function ledger_private.global_coverage_guard() returns trigger language plpgsql set search_path='' as $$
declare owner_id uuid:=coalesce(new.user_id,old.user_id); begin
 if exists(select 1 from public.wallets w where w.user_id=owner_id and w.default_balance_id is null
 and exists(select 1 from public.wallet_balances b where b.wallet_id=w.id and b.user_id=owner_id)) then raise exception 'wallet.invalidDefault'; end if;
 if exists(select 1 from public.wallets w cross join public.currencies c
 where w.user_id=owner_id and c.user_id=owner_id and w.deleted_at is null and c.disabled_at is null
 and not exists(select 1 from public.wallet_balances b where b.wallet_id=w.id and b.user_id=owner_id and b.currency=c.code and b.detached_at is null)) then raise exception 'currency.incompleteCoverage'; end if;
 if exists(select 1 from public.wallets w where w.user_id=owner_id and w.deleted_at is null and not exists(
 select 1 from public.wallet_balances b join public.currencies c on(c.user_id,c.code)=(b.user_id,b.currency)
 where b.id=w.default_balance_id and b.wallet_id=w.id and b.user_id=owner_id and c.disabled_at is null and b.detached_at is null)) then raise exception 'wallet.invalidDefault'; end if;
 return null;
end $$;
revoke all on function ledger_private.global_coverage_guard() from public,anon,authenticated;
create constraint trigger global_wallet_coverage after insert or update or delete on public.wallets deferrable initially deferred for each row execute function ledger_private.global_coverage_guard();
create constraint trigger global_balance_coverage after insert or update or delete on public.wallet_balances deferrable initially deferred for each row execute function ledger_private.global_coverage_guard();
create constraint trigger global_catalog_coverage after insert or update or delete on public.currencies deferrable initially deferred for each row execute function ledger_private.global_coverage_guard();

-- Backfill only live/Needs-attention containers. Existing IDs, amounts, defaults,
-- snapshots, wallet order and every tombstone row remain unchanged.
do $$ declare owner_id uuid; begin
 for owner_id in select distinct user_id from public.currencies order by user_id loop
  insert into ledger_private.currency_operations values(owner_id,txid_current());
  perform ledger_private.sync_global_balances(owner_id);
  delete from ledger_private.currency_operations where user_id=owner_id and transaction_id=txid_current();
 end loop;
end $$;

create function public.create_currency(p_code text,p_symbol text,p_decimal_places integer) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; begin
 owner_id:=ledger_private.lock_global_catalog();
 set constraints public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 insert into ledger_private.currency_operations values(owner_id,txid_current());
 insert into public.currencies(user_id,code,symbol,decimal_places,created_at) values(owner_id,upper(btrim(p_code)),btrim(p_symbol),p_decimal_places,clock_timestamp());
 perform ledger_private.sync_global_balances(owner_id);
 set constraints public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage immediate;
 set constraints public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 delete from ledger_private.currency_operations where user_id=owner_id and transaction_id=txid_current();
end $$;
create function public.update_currency(p_current_code text,p_code text,p_symbol text,p_decimal_places integer) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; begin
 owner_id:=ledger_private.lock_global_catalog();
 perform ledger_private.lock_currency_definition(owner_id,p_current_code,false);
 set constraints public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 insert into ledger_private.currency_operations values(owner_id,txid_current());
 update public.currencies set code=upper(btrim(p_code)),symbol=btrim(p_symbol),decimal_places=p_decimal_places where user_id=owner_id and code=p_current_code;
 perform ledger_private.sync_global_balances(owner_id);
 set constraints public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage immediate;
 set constraints public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 delete from ledger_private.currency_operations where user_id=owner_id and transaction_id=txid_current();
end $$;
create function public.delete_currency(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid; c public.currencies; begin
 owner_id:=ledger_private.lock_global_catalog();
 c:=ledger_private.lock_currency_definition(owner_id,p_code,false);
 if c.first_used_at is not null then raise exception 'currency.used'; end if;
 if c.disabled_at is null and not exists(select 1 from public.currencies where user_id=owner_id and code<>p_code and disabled_at is null) then raise exception 'currency.lastEnabled'; end if;
 -- first_used_at is durable; these checks also protect against exceptional
 -- imported rows. FK constraints independently retain every referenced balance.
 if exists(select 1 from public.wallet_balance_totals where user_id=owner_id and currency=p_code and balance_minor<>0)
 or ledger_private.currency_has_dependency(owner_id,p_code) then raise exception 'currency.used'; end if;
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 insert into ledger_private.currency_operations values(owner_id,txid_current());
 perform ledger_private.switch_currency_defaults(owner_id,p_code);
 delete from public.wallet_balances where user_id=owner_id and currency=p_code;
 delete from public.currencies where user_id=owner_id and code=p_code;
 perform ledger_private.sync_global_balances(owner_id);
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage immediate;
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 delete from ledger_private.currency_operations where user_id=owner_id and transaction_id=txid_current();
end $$;
create or replace function public.set_currency_disabled(p_code text,p_disabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid; c public.currencies; begin
 owner_id:=ledger_private.lock_global_catalog();
 c:=ledger_private.lock_currency_definition(owner_id,p_code,false);
 if p_disabled is null then raise exception 'currency.unavailable'; end if;
 if p_disabled and c.disabled_at is null then
  if not exists(select 1 from public.currencies where user_id=owner_id and code<>p_code and disabled_at is null) then raise exception 'currency.lastEnabled'; end if;
  if exists(select 1 from public.wallet_balance_totals where user_id=owner_id and currency=p_code and balance_minor<>0) then raise exception 'currency.nonzero'; end if;
  if ledger_private.currency_has_dependency(owner_id,p_code) then raise exception 'currency.inUse'; end if;
 end if;
 set constraints public.wallet_default_guard,public.balance_default_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 insert into ledger_private.currency_operations values(owner_id,txid_current());
 if p_disabled then
  -- Disable never mutates tombstones. Deletion alone can clean empty defaults.
  update public.wallets w set default_balance_id=(select b.id from public.wallet_balances b join public.currencies x on(x.user_id,x.code)=(b.user_id,b.currency)
   where b.wallet_id=w.id and x.code<>p_code and x.disabled_at is null and b.detached_at is null
   order by ((x.created_at,x.code)>(c.created_at,c.code)) desc,x.created_at,x.code limit 1)
  where w.user_id=owner_id and w.deleted_at is null and exists(select 1 from public.wallet_balances b where b.id=w.default_balance_id and b.currency=p_code);
 end if;
 update public.currencies set disabled_at=case when p_disabled then coalesce(disabled_at,now()) else null end where user_id=owner_id and code=p_code;
 if not p_disabled then perform ledger_private.sync_global_balances(owner_id); end if;
 set constraints public.wallet_default_guard,public.balance_default_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage immediate;
 set constraints public.wallet_default_guard,public.balance_default_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 delete from ledger_private.currency_operations where user_id=owner_id and transaction_id=txid_current();
end $$;

-- Parameter names are PostgREST's public API; replace the obsolete signature.
drop function public.create_wallet(text,public.wallet_kind,text,bigint);
create function public.create_wallet(p_name text,p_kind public.wallet_kind,p_default_currency text,p_opening_minor bigint default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid; wallet_id uuid:=gen_random_uuid(); default_id uuid:=gen_random_uuid(); begin
 owner_id:=ledger_private.lock_global_catalog();
 perform ledger_private.lock_currency_definition(owner_id,p_default_currency,true);
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.wallet_order_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 insert into public.wallets(id,user_id,name,kind,default_balance_id) values(wallet_id,owner_id,p_name,p_kind,default_id);
 insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
 select case when c.code=p_default_currency then default_id else gen_random_uuid() end,owner_id,wallet_id,c.code,
 case when c.code=p_default_currency then p_opening_minor else 0 end,0
 from public.currencies c where c.user_id=owner_id and c.disabled_at is null order by c.created_at,c.code;
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.wallet_order_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage immediate;
 set constraints public.wallet_default_owner,public.wallet_default_guard,public.balance_default_guard,public.wallet_order_guard,public.global_wallet_coverage,public.global_balance_coverage,public.global_catalog_coverage deferred;
 return wallet_id;
end $$;

revoke insert,delete on public.currencies from authenticated;
revoke all on function public.add_wallet_balance(uuid,text),public.detach_wallet_balance(uuid) from public,anon,authenticated;
revoke all on function public.create_currency(text,text,integer),public.update_currency(text,text,text,integer),public.delete_currency(text),public.set_currency_disabled(text,boolean),public.create_wallet(text,public.wallet_kind,text,bigint) from public,anon;
grant execute on function public.create_currency(text,text,integer),public.update_currency(text,text,text,integer),public.delete_currency(text),public.set_currency_disabled(text,boolean),public.create_wallet(text,public.wallet_kind,text,bigint) to authenticated;
commit;
