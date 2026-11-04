-- Record actual cross-currency cash paid and change without requiring a quote.
create or replace function public.transactions_cashier_check() returns trigger
language plpgsql set search_path='' as $$
declare t public.transactions; change_value bigint;
begin
  select x.* into t from public.transactions x where x.id=new.id;
  if not found then return null; end if;
  if t.tender_minor is null then
    if t.change_wallet_id is not null or t.change_minor is not null or t.change_currency is not null
       or t.change_rate_base is not null or t.change_rate_quote is not null or t.change_rate_numerator is not null
       or t.change_rate_denominator is not null then raise exception 'invalid settlement'; end if;
    return null;
  end if;
  if t.kind::text<>'expense' or t.source is not null or t.installment_id is not null then raise exception 'invalid settlement'; end if;
  if t.change_wallet_id is null then
    if t.change_minor is not null or t.change_currency is not null or t.change_rate_base is not null
       or t.change_rate_quote is not null or t.change_rate_numerator is not null or t.change_rate_denominator is not null then
      raise exception 'invalid settlement';
    end if;
    if t.tender_minor<>t.amount_minor then raise exception 'settlement mismatch'; end if;
    return null;
  end if;
  if t.change_minor is null or t.change_currency is null then raise exception 'invalid settlement'; end if;
  if t.change_currency=t.currency then
    if t.change_rate_base is not null or t.change_rate_quote is not null or t.change_rate_numerator is not null
       or t.change_rate_denominator is not null then raise exception 'invalid settlement rate'; end if;
    change_value := t.change_minor;
  elsif t.change_rate_base is null and t.change_rate_quote is null
        and t.change_rate_numerator is null and t.change_rate_denominator is null then
    -- Independent actual cash movements; never infer or apply a profile rate.
    if t.tender_minor<=t.amount_minor then raise exception 'settlement mismatch'; end if;
    return null;
  else
    change_value := public.cashier_convert_minor(t.change_minor,t.change_currency,t.currency,
      t.change_rate_base,t.change_rate_quote,t.change_rate_numerator,t.change_rate_denominator);
  end if;
  if change_value<=0 or t.tender_minor-change_value<>t.amount_minor then raise exception 'settlement mismatch'; end if;
  return null;
end;
$$;
