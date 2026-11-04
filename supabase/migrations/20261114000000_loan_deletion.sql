-- Direct DELETE remains blocked by RLS. These narrow entry points explicitly
-- authorize the owner, serialize on the loan, and retain all integrity triggers.
-- Keep only request identities (no amounts, names or transaction history) so
-- response-lost forms cannot retry an old insertion and resurrect deleted cash.
create table public.loan_deleted_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_kind text not null check (request_kind in ('loan','payment')),
  request_id uuid not null,
  primary key(user_id,request_kind,request_id)
);
alter table public.loan_deleted_requests enable row level security;
revoke all on public.loan_deleted_requests from anon,authenticated;

create function public.retire_loan_request(p_user_id uuid,p_kind text,p_request_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('retired-loan:'||p_user_id::text||':'||p_kind||':'||p_request_id::text,0));
  insert into public.loan_deleted_requests(user_id,request_kind,request_id)
    values(p_user_id,p_kind,p_request_id) on conflict do nothing;
end $$;

create function public.loan_deleted_request_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_request_kind text; request_uuid uuid;
begin
  if tg_table_name='loans' then v_request_kind:='loan'; request_uuid:=new.request_id;
  else v_request_kind:='payment'; request_uuid:=new.loan_request_id; end if;
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'loan.invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('retired-loan:'||new.user_id::text||':'||v_request_kind||':'||request_uuid::text,0));
  if exists(select 1 from public.loan_deleted_requests r where r.user_id=new.user_id and r.request_kind=v_request_kind and r.request_id=request_uuid) then
    raise exception 'loan.conflict';
  end if;
  return new;
end $$;
-- Run after the existing financial guards acquire their parent/wallet locks.
create trigger z_loan_deleted_request_guard before insert on public.loans
  for each row execute function public.loan_deleted_request_guard();
create trigger z_loan_deleted_request_guard before insert on public.transactions
  for each row when (new.loan_event='repayment') execute function public.loan_deleted_request_guard();

create function public.delete_loan(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); l public.loans; request_uuid uuid;
begin
  if caller is null then raise exception 'loan.invalid'; end if;
  select * into l from public.loans where id=p_id and user_id=caller for update;
  if not found then raise exception 'loan.invalid'; end if;
  if l.archived_at is null then raise exception 'loan.inUse'; end if;
  perform public.retire_loan_request(caller,'loan',l.request_id);
  for request_uuid in select loan_request_id from public.transactions
    where loan_id=l.id and user_id=caller and loan_event='repayment' order by loan_request_id
  loop
    perform public.retire_loan_request(caller,'payment',request_uuid);
  end loop;
  -- Include voided entries: no loan history or wallet movement is retained.
  -- Balances and fee reporting are derived from the remaining transactions.
  delete from public.transactions where loan_id=l.id and user_id=caller;
  delete from public.loans where id=l.id and user_id=caller;
end $$;

create function public.delete_loan_payment(p_transaction_id uuid,p_expected_revision integer)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); loan_uuid uuid; l public.loans; t public.transactions;
begin
  if caller is null then raise exception 'loan.invalid'; end if;
  select loan_id into loan_uuid from public.transactions
    where id=p_transaction_id and user_id=caller and loan_event='repayment' and kind::text='loan';
  if not found then raise exception 'loan.invalid'; end if;
  -- Match the lock order of record/void/restore and whole-loan deletion.
  select * into l from public.loans where id=loan_uuid and user_id=caller for update;
  if not found then raise exception 'loan.invalid'; end if;
  select * into t from public.transactions
    where id=p_transaction_id and user_id=caller and loan_id=l.id and loan_event='repayment' for update;
  if not found then raise exception 'loan.conflict'; end if;
  if p_expected_revision is null or p_expected_revision<1 or t.revision<>p_expected_revision then
    raise exception 'loan.conflict';
  end if;
  perform public.retire_loan_request(caller,'payment',t.loan_request_id);
  -- Removing an active repayment reopens a settled archived loan. Canceled
  -- loans contain only voided repayments, which can be removed without editing it.
  if t.deleted_at is null and l.archived_at is not null then
    update public.loans set archived_at=null where id=l.id and user_id=caller;
  end if;
  -- Preserve other payments' original splits; loan_progress sums what remains.
  delete from public.transactions where id=t.id and user_id=caller;
end $$;

revoke all on function public.delete_loan(uuid),public.delete_loan_payment(uuid,integer) from public,anon;
grant execute on function public.delete_loan(uuid),public.delete_loan_payment(uuid,integer) to authenticated;
revoke all on function public.retire_loan_request(uuid,text,uuid),public.loan_deleted_request_guard() from public,anon,authenticated;
