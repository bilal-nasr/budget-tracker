-- Moving money between wallets. One "transfer" row per move:
--   wallet_id + amount_minor       = the wallet money leaves, and how much
--   to_wallet_id + to_amount_minor = the wallet money arrives in, and how much
-- Same currency: both amounts must be equal. Different currency (an exchange):
-- the two amounts are whatever you actually sent and received; no rate is assumed.
-- Transfers have no category and never count as income or spending.

alter table public.transactions
  add column to_wallet_id uuid references public.wallets (id),
  add column to_amount_minor bigint
    check (to_amount_minor is null or to_amount_minor between 1 and 1000000000000000),
  alter column category_id drop not null;

alter table public.transactions
  add constraint transactions_kind_shape check (
    (kind::text in ('expense', 'income')
      and category_id is not null and to_wallet_id is null and to_amount_minor is null)
    or
    (kind::text = 'transfer'
      and category_id is null and to_wallet_id is not null and to_amount_minor is not null
      and to_wallet_id <> wallet_id)
  );

create index transactions_to_wallet_idx on public.transactions (to_wallet_id)
  where to_wallet_id is not null and deleted_at is null;

-- Integrity: replaces the earlier function. RLS applies to the lookups, so
-- another user's wallet or category simply "does not exist".
create or replace function public.transactions_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  w record;
  tw record;
  c record;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'user_id cannot change';
  end if;

  select id, currency, archived_at into w from public.wallets where id = new.wallet_id;
  if not found then
    raise exception 'wallet not found';
  end if;
  if w.archived_at is not null
     and (tg_op = 'INSERT' or new.wallet_id is distinct from old.wallet_id) then
    raise exception 'wallet is archived';
  end if;
  new.currency := w.currency;

  if new.kind::text = 'transfer' then
    select id, currency, archived_at into tw from public.wallets where id = new.to_wallet_id;
    if not found then
      raise exception 'destination wallet not found';
    end if;
    if tw.archived_at is not null
       and (tg_op = 'INSERT' or new.to_wallet_id is distinct from old.to_wallet_id) then
      raise exception 'destination wallet is archived';
    end if;
    if tw.currency = w.currency and new.to_amount_minor <> new.amount_minor then
      raise exception 'same-currency transfers must have equal amounts';
    end if;
  else
    select id, kind into c from public.categories where id = new.category_id;
    if not found then
      raise exception 'category not found';
    end if;
    if c.kind::text <> new.kind::text then
      raise exception 'category kind does not match transaction kind';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Balance per wallet: opening, plus income, minus expenses, minus what left in
-- transfers, plus what arrived in transfers. Soft-deleted rows are ignored.
create or replace view public.wallet_balances
with (security_invoker = true) as
select
  w.id as wallet_id,
  w.user_id,
  w.opening_balance_minor
    + coalesce((
        select sum(case t.kind::text
                     when 'income' then t.amount_minor
                     else -t.amount_minor
                   end)
        from public.transactions t
        where t.wallet_id = w.id and t.deleted_at is null
      ), 0)
    + coalesce((
        select sum(t.to_amount_minor)
        from public.transactions t
        where t.to_wallet_id = w.id and t.deleted_at is null and t.kind::text = 'transfer'
      ), 0)
    as balance_minor
from public.wallets w;

revoke execute on function public.transactions_integrity() from public, anon, authenticated;
