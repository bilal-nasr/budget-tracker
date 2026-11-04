-- SYP follows LBP: one ledger unit is one whole pound.
-- Run with the app stopped; deploy together with the whole-pound frontend.
-- Exact conversion only: fractional-pound history aborts the entire migration.
-- Resolve such records explicitly before retrying; never silently round money.
begin;
lock table public.wallets, public.profiles, public.transactions, public.expense_items,
  public.fixed_expenses, public.installments, public.budgets, public.loans in access exclusive mode;

create function pg_temp.syp_whole(p_value numeric) returns bigint
language plpgsql as $$
begin
  if p_value is null then return null; end if;
  if p_value % 100 <> 0 then
    raise exception 'SYP migration stopped: fractional-pound history (%) requires explicit resolution before converting to whole pounds', p_value;
  end if;
  return (p_value / 100)::bigint;
end;
$$;

-- Loan replay payloads carry original monetary inputs, including deleted events.
create function pg_temp.syp_payload(p_value jsonb) returns jsonb
language plpgsql as $$
declare result jsonb := p_value; entry record;
begin
  if jsonb_typeof(p_value) <> 'object' then return p_value; end if;
  for entry in select * from jsonb_each(p_value) loop
    if entry.key like '%Minor' and jsonb_typeof(entry.value) = 'number' then
      result := jsonb_set(result, array[entry.key], to_jsonb(pg_temp.syp_whole(entry.value::text::numeric)));
    end if;
  end loop;
  return result;
end;
$$;

-- Preserve immutable historical associations, revisions, and archived records.
-- All trigger changes are transactional; a failed conversion restores everything.
alter table public.wallets disable trigger user;
alter table public.profiles disable trigger user;
alter table public.transactions disable trigger user;
alter table public.expense_items disable trigger user;
alter table public.fixed_expenses disable trigger user;
alter table public.installments disable trigger user;
alter table public.budgets disable trigger user;
alter table public.loans disable trigger user;

update public.wallets set opening_balance_minor=pg_temp.syp_whole(opening_balance_minor) where currency='SYP';
update public.profiles p set salary_amount_minor=pg_temp.syp_whole(p.salary_amount_minor)
  from public.wallets w where w.id=p.salary_wallet_id and w.currency='SYP';
update public.fixed_expenses f set amount_minor=pg_temp.syp_whole(f.amount_minor)
  from public.wallets w where w.id=f.wallet_id and w.currency='SYP';
update public.installments set total_minor=pg_temp.syp_whole(total_minor),
  paid_before_minor=pg_temp.syp_whole(paid_before_minor), monthly_minor=pg_temp.syp_whole(monthly_minor)
  where currency='SYP';
update public.budgets set limit_minor=pg_temp.syp_whole(limit_minor) where currency='SYP';
update public.expense_items i set amount_minor=pg_temp.syp_whole(i.amount_minor)
  from public.transactions t where t.id=i.transaction_id and t.currency='SYP';
update public.loans set principal_minor=pg_temp.syp_whole(principal_minor),
  fee_minor=pg_temp.syp_whole(fee_minor), total_due_minor=pg_temp.syp_whole(total_due_minor),
  principal_paid_before_minor=pg_temp.syp_whole(principal_paid_before_minor),
  fee_paid_before_minor=pg_temp.syp_whole(fee_paid_before_minor),
  monthly_payment_minor=pg_temp.syp_whole(monthly_payment_minor),
  request_payload=pg_temp.syp_payload(request_payload) where currency='SYP';
update public.transactions t set
  amount_minor=case when currency='SYP' then pg_temp.syp_whole(amount_minor) else amount_minor end,
  tender_minor=case when currency='SYP' then pg_temp.syp_whole(tender_minor) else tender_minor end,
  loan_principal_minor=case when currency='SYP' then pg_temp.syp_whole(loan_principal_minor) else loan_principal_minor end,
  loan_fee_minor=case when currency='SYP' then pg_temp.syp_whole(loan_fee_minor) else loan_fee_minor end,
  loan_payload=case when currency='SYP' then pg_temp.syp_payload(loan_payload) else loan_payload end,
  to_amount_minor=case when exists(select 1 from public.wallets w where w.id=t.to_wallet_id and w.currency='SYP')
    then pg_temp.syp_whole(to_amount_minor) else to_amount_minor end,
  change_minor=case when change_currency='SYP' then pg_temp.syp_whole(change_minor) else change_minor end
  where currency='SYP' or change_currency='SYP'
    or exists(select 1 from public.wallets w where w.id=t.to_wallet_id and w.currency='SYP');

create or replace function public.cashier_convert_minor(p_minor bigint,p_from public.currency,p_to public.currency,
  p_base public.currency,p_quote public.currency,p_n bigint,p_d bigint)
returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric; d numeric; base_scale integer; quote_scale integer; result numeric;
begin
  if p_minor is null or p_minor not between 0 and 1000000000000000
     or p_n is null or p_n not between 1 and 1000000000000000
     or p_d is null or p_d not between 1 and 1000000 or 1000000 % p_d <> 0
     or p_n::numeric > 1000000000::numeric*p_d
     or p_from is null or p_to is null or p_base is null or p_quote is null
     or not ((p_base::text='USD' and p_quote::text in ('LBP','SYP')) or (p_base::text='LBP' and p_quote::text='SYP'))
     or not ((p_from=p_base and p_to=p_quote) or (p_from=p_quote and p_to=p_base))
     or (p_base::text='USD' and p_quote::text='LBP' and (p_d<>1 or p_n>10000000)) then
    raise exception 'invalid settlement rate';
  end if;
  -- Matches the ledger registry: USD cents, LBP and SYP whole pounds.
  base_scale := case p_base::text when 'USD' then 100 else 1 end;
  quote_scale := case p_quote::text when 'USD' then 100 else 1 end;
  if p_from=p_base then
    n := p_minor::numeric*p_n*quote_scale; d := p_d::numeric*base_scale;
  else
    n := p_minor::numeric*p_d*base_scale; d := p_n::numeric*quote_scale;
  end if;
  -- numeric / may round a near-integer quotient before floor; div truncates
  -- the positive integer numerator/denominator exactly, matching BigInt.
  result := div(2*n+d,2*d);
  if result>1000000000000000 then raise exception 'invalid settlement rate'; end if;
  return result::bigint;
end;
$$;

-- Validate settlement snapshots using the new scales, including deleted history.
do $$
declare t record;
begin
  for t in select * from public.transactions where change_minor is not null
    and (currency='SYP' or change_currency='SYP') loop
    if t.currency=t.change_currency then
      if t.tender_minor-t.change_minor<>t.amount_minor then raise exception 'SYP settlement mismatch'; end if;
    elsif t.tender_minor-public.cashier_convert_minor(t.change_minor,t.change_currency,t.currency,
      t.change_rate_base,t.change_rate_quote,t.change_rate_numerator,t.change_rate_denominator)<>t.amount_minor then
      raise exception 'SYP settlement mismatch';
    end if;
  end loop;
end;
$$;

alter table public.wallets enable trigger user;
alter table public.profiles enable trigger user;
alter table public.transactions enable trigger user;
alter table public.expense_items enable trigger user;
alter table public.fixed_expenses enable trigger user;
alter table public.installments enable trigger user;
alter table public.budgets enable trigger user;
alter table public.loans enable trigger user;

comment on type public.currency is 'Ledger currencies: USD cents, LBP whole pounds, SYP whole pounds.';
drop function pg_temp.syp_payload(jsonb);
drop function pg_temp.syp_whole(numeric);
commit;
