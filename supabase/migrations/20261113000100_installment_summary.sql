-- One statement snapshot preserves receipt membership and exact lifetime progress
-- without sending every canonical transaction and expense item to Home/Budgets.
create function public.installment_cycle_summary()
returns jsonb language sql stable security invoker set search_path='' as $$
  with receipt as (
    select t.id,t.occurred_on,t.created_at
    from public.transactions t
    where t.user_id=(select auth.uid()) and t.source='salary' and t.kind::text='income' and t.deleted_at is null
    order by t.created_at desc,t.id desc limit 1
  ), progress as (
    select t.installment_id, sum(t.amount_minor)::bigint as paid_minor,
      coalesce(sum(t.amount_minor) filter(where t.salary_cycle_id is not distinct from (select id from receipt)),0)::bigint as paid_this_cycle_minor,
      count(*) filter(where t.salary_cycle_id is not distinct from (select id from receipt)) as cycle_payment_count,
      (array_agg(t.id order by t.created_at desc,t.id desc)
        filter(where t.salary_cycle_id is not distinct from (select id from receipt)))[1] as cycle_latest_payment_id
    from public.transactions t
    where t.user_id=(select auth.uid()) and t.installment_id is not null and t.deleted_at is null
    group by t.installment_id
  )
  select jsonb_build_object(
    'receipt',(select to_jsonb(r) from receipt r),
    'installments',coalesce((select jsonb_agg(
      (to_jsonb(i)-'user_id') || jsonb_build_object(
        'paid_minor',i.paid_before_minor+coalesce(p.paid_minor,0),
        'remaining_minor',i.total_minor-i.paid_before_minor-coalesce(p.paid_minor,0),
        'paid_this_cycle_minor',coalesce(p.paid_this_cycle_minor,0),
        'cycle_payment_count',coalesce(p.cycle_payment_count,0),
        'cycle_latest_payment_id',p.cycle_latest_payment_id)
      order by i.position,i.created_at,i.id)
      from public.installments i left join progress p on p.installment_id=i.id
      where i.user_id=(select auth.uid())), '[]'::jsonb)
  );
$$;
revoke execute on function public.installment_cycle_summary() from public,anon;
grant execute on function public.installment_cycle_summary() to authenticated;

create index transactions_installment_history_idx on public.transactions(installment_id,created_at desc,id desc)
  where installment_id is not null and deleted_at is null;
