-- Canceled loans may also be permanently removed without first archiving.
-- Preserve ownership, request retirement, and atomic transaction cleanup.
create or replace function public.delete_loan(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); l public.loans; request_uuid uuid;
begin
  if caller is null then raise exception 'loan.invalid'; end if;
  select * into l from public.loans where id=p_id and user_id=caller for update;
  if not found then raise exception 'loan.invalid'; end if;
  if l.archived_at is null and l.deleted_at is null then raise exception 'loan.inUse'; end if;
  perform public.retire_loan_request(caller,'loan',l.request_id);
  for request_uuid in select loan_request_id from public.transactions
    where loan_id=l.id and user_id=caller and loan_event='repayment' order by loan_request_id
  loop
    perform public.retire_loan_request(caller,'payment',request_uuid);
  end loop;
  -- Canceled entries already have no wallet effect; deleting them cannot
  -- reverse those movements a second time because balances use live rows only.
  delete from public.transactions where loan_id=l.id and user_id=caller;
  delete from public.loans where id=l.id and user_id=caller;
end $$;

revoke all on function public.delete_loan(uuid) from public,anon;
grant execute on function public.delete_loan(uuid) to authenticated;
