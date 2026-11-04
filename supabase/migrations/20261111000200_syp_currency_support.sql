-- SYP is the current/new Syrian pound, stored as integer qirsh (100 per pound).
-- This migration changes no amount, reference rate, default wallet or history.
comment on type public.currency is
  'Ledger currencies: USD cents, LBP whole lira, SYP current/new-pound qirsh (100 per pound).';

-- Money already referencing a wallet cannot be reinterpreted by changing its
-- currency, including incoming-only/deleted transfers and unpaid templates.
-- Category lifecycle/transaction guards remain intact: do not replace them.
create or replace function public.wallets_currency_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot change';
  end if;

  if new.currency is distinct from old.currency and (
    exists (
      select 1 from public.transactions t
      where t.wallet_id = old.id or t.to_wallet_id = old.id
    )
    or exists (select 1 from public.profiles p where p.salary_wallet_id = old.id)
    or exists (select 1 from public.fixed_expenses f where f.wallet_id = old.id)
    or exists (select 1 from public.installments i where i.wallet_id = old.id)
  ) then
    raise exception 'wallet currency cannot change while it has monetary references';
  end if;
  return new;
end;
$$;

revoke execute on function public.wallets_currency_locked() from public, anon, authenticated;

-- A foreign key's KEY SHARE lock permits a concurrent non-key currency UPDATE.
-- Take SHARE before incumbent reference guards read the wallet: it conflicts
-- with that UPDATE and keeps the read currency stable until the writer commits.
-- Separate, alphabetically early triggers preserve every owner/category/archive
-- guard, including the later category lifecycle triggers. Existing references
-- already lock currency logically, so only new/reassigned links need a row lock.
create function public.wallet_reference_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_wallet_id uuid;
begin
  -- Leave identity validation and its established error to the incumbent guard.
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    return new;
  end if;
  if tg_table_name = 'profiles' then
    v_wallet_id := new.salary_wallet_id;
    if tg_op = 'UPDATE' and new.salary_wallet_id is not distinct from old.salary_wallet_id then
      return new;
    end if;
  else
    v_wallet_id := new.wallet_id;
    if tg_op = 'UPDATE' and new.wallet_id is not distinct from old.wallet_id then
      return new;
    end if;
  end if;

  if v_wallet_id is not null then
    perform 1 from public.wallets w
    where w.id = v_wallet_id and w.user_id = new.user_id
    for share;
  end if;
  -- Missing/foreign/archived wallets are still rejected by the original guards.
  return new;
end;
$$;

create trigger aa_wallet_reference_lock before insert or update on public.installments
  for each row execute function public.wallet_reference_lock();
create trigger aa_wallet_reference_lock before insert or update on public.fixed_expenses
  for each row execute function public.wallet_reference_lock();
create trigger aa_wallet_reference_lock before insert or update on public.profiles
  for each row execute function public.wallet_reference_lock();
revoke execute on function public.wallet_reference_lock() from public, anon, authenticated;

-- One atomic transfer row is the accounting event for both actual amounts.
-- No rate is needed for any pair. An optional rate memo is strictly USD/LBP;
-- it neither computes nor overrides either actual amount.
create function public.record_transfer(
  p_occurred_on date,
  p_from_wallet_id uuid,
  p_to_wallet_id uuid,
  p_from_amount_minor bigint,
  p_to_amount_minor bigint,
  p_note text default null,
  p_usd_lbp_rate integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_wallet record;
  v_wallet_count integer := 0;
  v_from_currency public.currency;
  v_to_currency public.currency;
  v_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_from_wallet_id is null or p_to_wallet_id is null
     or p_from_wallet_id = p_to_wallet_id then
    raise exception using errcode = '22023', message = 'distinct wallets are required';
  end if;
  if p_from_amount_minor is null or p_to_amount_minor is null
     or p_from_amount_minor not between 1 and 1000000000000000
     or p_to_amount_minor not between 1 and 1000000000000000 then
    raise exception using errcode = '22023', message = 'invalid transfer amounts';
  end if;
  if p_occurred_on is null or p_occurred_on < date '2000-01-01'
     or (p_note is not null and char_length(btrim(p_note)) > 140) then
    raise exception using errcode = '22023', message = 'invalid transfer details';
  end if;
  if p_usd_lbp_rate is not null and p_usd_lbp_rate not between 1 and 10000000 then
    raise exception using errcode = '22023', message = 'invalid USD/LBP rate';
  end if;

  -- Canonical expense/cycle saves lock the owning profile before their wallets.
  -- Use the same global order even for a transfer without a rate, so the optional
  -- profile memo cannot deadlock with a simultaneous profile-first expense.
  perform 1 from public.profiles where user_id = v_user_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  -- Deterministic row-lock ordering avoids reversed-transfer deadlocks and
  -- serializes the pair check with wallet archive/currency edits. RLS plus the
  -- explicit owner predicate makes foreign wallets indistinguishable from absent.
  for v_wallet in
    select w.id, w.currency, w.archived_at
    from public.wallets w
    where w.user_id = v_user_id and w.id in (p_from_wallet_id, p_to_wallet_id)
    order by w.id
    for update
  loop
    if v_wallet.archived_at is not null then
      raise exception using errcode = '22023', message = 'wallet not found or archived';
    end if;
    v_wallet_count := v_wallet_count + 1;
    if v_wallet.id = p_from_wallet_id then
      v_from_currency := v_wallet.currency;
    else
      v_to_currency := v_wallet.currency;
    end if;
  end loop;
  if v_wallet_count <> 2 then
    raise exception using errcode = '22023', message = 'wallet not found or archived';
  end if;

  if v_from_currency = v_to_currency and p_from_amount_minor <> p_to_amount_minor then
    raise exception using errcode = '22023', message = 'same-currency transfers must have equal amounts';
  end if;
  if p_usd_lbp_rate is not null and not (
    (v_from_currency = 'USD' and v_to_currency = 'LBP')
    or (v_from_currency = 'LBP' and v_to_currency = 'USD')
  ) then
    raise exception using errcode = '22023', message = 'rate is only supported for USD/LBP exchanges';
  end if;

  insert into public.transactions (
    user_id, kind, occurred_on, wallet_id, amount_minor, currency,
    to_wallet_id, to_amount_minor, note
  ) values (
    v_user_id, 'transfer', p_occurred_on, p_from_wallet_id, p_from_amount_minor,
    v_from_currency, p_to_wallet_id, p_to_amount_minor, nullif(btrim(p_note), '')
  ) returning id into v_transaction_id;

  if p_usd_lbp_rate is not null then
    -- The two actual amounts are the financial fact. Preserve the existing
    -- best-effort memo contract without rolling back that fact if memo storage
    -- fails. Argument/pair validation above is outside this exception block.
    begin
      update public.profiles set usd_lbp_rate = p_usd_lbp_rate
      where user_id = v_user_id;
    exception when others then
      null;
    end;
  end if;
  return v_transaction_id;
end;
$$;

revoke all on function public.record_transfer(date, uuid, uuid, bigint, bigint, text, integer) from public, anon;
grant execute on function public.record_transfer(date, uuid, uuid, bigint, bigint, text, integer) to authenticated;
