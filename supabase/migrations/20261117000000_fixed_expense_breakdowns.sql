-- Optional template composition; only the payment transaction affects balances.
alter table public.fixed_expenses add column items jsonb not null default '[]'::jsonb;

create function public.fixed_expense_items_check()
returns trigger language plpgsql set search_path = '' as $$
declare
  line jsonb;
  total numeric := 0;
  old_currency text;
  new_currency text;
begin
  if jsonb_typeof(new.items) <> 'array' then
    raise exception using errcode='22023', message='invalid fixed expense items';
  end if;
  if jsonb_array_length(new.items) > 50 then
    raise exception using errcode='22023', message='invalid fixed expense items';
  end if;
  for line in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(line) <> 'object' or not (line ?& array['description','amountMinor'])
      or (line - 'description' - 'amountMinor') <> '{}'::jsonb
      or jsonb_typeof(line->'description') <> 'string'
      or char_length(btrim(line->>'description', E' \t\n\r\f\013')) not between 1 and 140
      or jsonb_typeof(line->'amountMinor') <> 'number' then
      raise exception using errcode='22023', message='invalid fixed expense items';
    end if;
    if (line->>'amountMinor')::numeric <> trunc((line->>'amountMinor')::numeric)
      or (line->>'amountMinor')::numeric not between 1 and 1000000000000000 then
      raise exception using errcode='22023', message='invalid fixed expense items';
    end if;
    total := total + (line->>'amountMinor')::numeric;
  end loop;
  if total > new.amount_minor then
    raise exception using errcode='BT001', message='breakdown exceeds total';
  end if;
  if tg_op = 'UPDATE' and new.wallet_id is distinct from old.wallet_id
    and (jsonb_array_length(old.items) > 0 or jsonb_array_length(new.items) > 0) then
    select currency into old_currency from public.wallets where id=old.wallet_id;
    select currency into new_currency from public.wallets where id=new.wallet_id;
    if old_currency is distinct from new_currency then
      raise exception using errcode='BT002', message='breakdown currency locked';
    end if;
  end if;
  return new;
end;
$$;
create trigger fixed_expense_items_check before insert or update on public.fixed_expenses
  for each row execute function public.fixed_expense_items_check();
revoke execute on function public.fixed_expense_items_check() from public,anon,authenticated;

-- Read the saved template under a lock and copy its items in the same transaction.
-- Invoker security retains the existing ownership, category and wallet checks.
create function public.pay_fixed_expense(p_id uuid)
returns table(id uuid, revision integer)
language plpgsql security invoker set search_path='' as $$
declare
  caller uuid := auth.uid();
  item public.fixed_expenses%rowtype;
  owner_timezone text;
  payment_id uuid;
begin
  if caller is null then raise exception using errcode='42501',message='authentication required'; end if;
  select p.timezone into owner_timezone from public.profiles p where p.user_id=caller for update;
  if not found then raise exception using errcode='22023',message='profile not found'; end if;
  select f.* into item from public.fixed_expenses f where f.id=p_id and f.user_id=caller for update;
  if not found then raise exception using errcode='22023',message='fixed expense not found'; end if;
  insert into public.transactions(user_id,kind,occurred_on,wallet_id,amount_minor,currency,category_id,note,source,fixed_expense_id)
  values(caller,'expense',pg_catalog.timezone(owner_timezone,pg_catalog.clock_timestamp())::date,
    item.wallet_id,item.amount_minor,'USD',item.category_id,item.name,'fixed',item.id)
  returning transactions.id into payment_id;
  insert into public.expense_items(user_id,transaction_id,description,amount_minor,position)
  select caller,payment_id,btrim(line.value->>'description', E' \t\n\r\f\013'),
    (line.value->>'amountMinor')::numeric::bigint,(line.ordinality-1)::smallint
  from jsonb_array_elements(item.items) with ordinality as line(value,ordinality);
  set constraints public.expense_items_valid,public.transactions_breakdown_valid immediate;
  set constraints public.expense_items_valid,public.transactions_breakdown_valid deferred;
  return query select t.id,t.revision from public.transactions t where t.id=payment_id and t.user_id=caller;
end;
$$;
revoke execute on function public.pay_fixed_expense(uuid) from public,anon;
grant execute on function public.pay_fixed_expense(uuid) to authenticated;
