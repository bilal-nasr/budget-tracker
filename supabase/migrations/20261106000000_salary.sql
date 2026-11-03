-- Salary: a fixed monthly amount and the wallet it lands in, plus a tag on
-- transactions so "Got salary" entries can be recognised (and undone) reliably.

alter table public.profiles
  add column salary_amount_minor bigint
    check (salary_amount_minor is null or salary_amount_minor between 1 and 1000000000000000),
  add column salary_wallet_id uuid references public.wallets (id),
  add constraint profiles_salary_complete
    check ((salary_amount_minor is null) = (salary_wallet_id is null));

alter table public.transactions
  add column source text check (source is null or source in ('salary'));

create index transactions_salary_idx on public.transactions (user_id, occurred_on desc)
  where source = 'salary' and deleted_at is null;

-- The salary wallet must be the caller's own and not archived. RLS applies to
-- the lookup, so another user's wallet simply "does not exist".
create function public.profiles_salary_wallet_ok()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.salary_wallet_id is not null
     and (tg_op = 'INSERT' or new.salary_wallet_id is distinct from old.salary_wallet_id)
     and not exists (
       select 1 from public.wallets w
       where w.id = new.salary_wallet_id and w.archived_at is null
     ) then
    raise exception 'salary wallet not found or archived';
  end if;
  return new;
end;
$$;

create trigger profiles_salary_wallet_ok
  before insert or update on public.profiles
  for each row execute function public.profiles_salary_wallet_ok();

revoke execute on function public.profiles_salary_wallet_ok() from public, anon, authenticated;
