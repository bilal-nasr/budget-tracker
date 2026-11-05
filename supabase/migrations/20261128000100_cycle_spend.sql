-- Spending per pay cycle instead of calendar month. A cycle runs from one salary
-- receipt date up to (not including) the next one; p_to null means the open,
-- current cycle. Same inputs as month_category_spend: expenses plus realized
-- loan fees, grouped under the top-level category and currency.
create function public.category_spend_between(p_from date, p_to date)
returns table(category_id uuid, currency text, spent_minor bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(c.parent_id, c.id), t.currency, sum(t.amount_minor)::bigint
  from public.reporting_entries t join public.categories c on c.id = t.category_id
  where t.kind = 'expense' and t.occurred_on >= p_from and (p_to is null or t.occurred_on < p_to)
  group by coalesce(c.parent_id, c.id), t.currency;
$$;
revoke execute on function public.category_spend_between(date, date) from public, anon;
grant execute on function public.category_spend_between(date, date) to authenticated;
