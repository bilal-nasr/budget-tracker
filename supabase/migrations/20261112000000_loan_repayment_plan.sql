-- Optional manual repayment plan. Never changes debt, cash flow or historical postings.
alter table public.loans
  add column monthly_payment_minor bigint,
  add column payment_count integer,
  add constraint loans_repayment_plan check (
    (monthly_payment_minor is null and payment_count is null) or
    (monthly_payment_minor is not null and payment_count is not null
      and monthly_payment_minor between 1 and 1000000000000000 and payment_count between 1 and 1200
      and total_due_minor::numeric-monthly_payment_minor::numeric*(payment_count-1) between 1 and 1000000000000000)
  );

-- Preserve the existing view column order; l.* would shift its computed columns.


create or replace view public.loan_progress with (security_invoker=true) as
select l.id, l.user_id, l.request_id, l.request_payload, l.name, l.direction, l.currency, l.wallet_id, l.fee_category_id, l.principal_minor, l.fee_bps, l.fee_minor, l.total_due_minor, l.creation_mode, l.opened_on, l.principal_paid_before_minor, l.fee_paid_before_minor, l.created_at, l.archived_at, l.deleted_at,
  (l.principal_paid_before_minor+coalesce(p.principal,0))::bigint as principal_paid_minor,
  (l.fee_paid_before_minor+coalesce(p.fee,0))::bigint as fee_paid_minor,
  (l.principal_minor-l.principal_paid_before_minor-coalesce(p.principal,0))::bigint as principal_remaining_minor,
  (l.fee_minor-l.fee_paid_before_minor-coalesce(p.fee,0))::bigint as fee_remaining_minor,
  (l.total_due_minor-l.principal_paid_before_minor-l.fee_paid_before_minor-coalesce(p.principal,0)-coalesce(p.fee,0))::bigint as remaining_minor,
  l.monthly_payment_minor, l.payment_count
from public.loans l left join lateral (
  select sum(t.loan_principal_minor) as principal,sum(t.loan_fee_minor) as fee
  from public.transactions t where t.loan_id=l.id and t.loan_event='repayment' and t.deleted_at is null
) p on true;

create or replace function public.loans_integrity() returns trigger language plpgsql set search_path='' as $$
declare w record; c record; fee numeric; paid numeric;
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'loan.invalid'; end if;
  -- Terms and request identity cannot be rewritten after the first posting.
  if tg_op='UPDATE' then
    if (to_jsonb(new)-array['name','wallet_id','fee_category_id','archived_at','deleted_at','monthly_payment_minor','payment_count'])
       is distinct from (to_jsonb(old)-array['name','wallet_id','fee_category_id','archived_at','deleted_at','monthly_payment_minor','payment_count']) then
      raise exception 'loan.termsLocked';
    end if;
    if old.deleted_at is not null then raise exception 'loan.loanClosed'; end if;
  end if;
  select * into w from public.wallets where id=new.wallet_id and user_id=new.user_id for update;
  if not found then raise exception 'loan.invalid'; end if;
  if tg_op='INSERT' then new.currency:=w.currency;
  elsif w.currency<>new.currency then raise exception 'loan.invalid'; end if;
  if w.archived_at is not null and (tg_op='INSERT' or new.wallet_id is distinct from old.wallet_id) then raise exception 'loan.invalid'; end if;
  select * into c from public.categories where id=new.fee_category_id and user_id=new.user_id for share;
  if not found or c.kind::text<>(case when new.direction='borrowed' then 'expense' else 'income' end) then raise exception 'loan.invalid'; end if;
  if c.archived_at is not null and (tg_op='INSERT' or new.fee_category_id is distinct from old.fee_category_id) then raise exception 'loan.invalid'; end if;
  fee:=floor((new.principal_minor::numeric*new.fee_bps+5000)/10000);
  if fee+new.principal_minor>1000000000000000 then raise exception 'loan.invalid'; end if;
  new.fee_minor:=fee::bigint; new.total_due_minor:=new.principal_minor+new.fee_minor;
  if (new.monthly_payment_minor is null) <> (new.payment_count is null)
    or (new.monthly_payment_minor is not null and
      (new.monthly_payment_minor not between 1 and 1000000000000000 or new.payment_count not between 1 and 1200
       or new.total_due_minor::numeric-new.monthly_payment_minor::numeric*(new.payment_count-1) not between 1 and 1000000000000000))
    then raise exception 'loan.invalid'; end if;
  if new.opened_on>public.loan_today() then raise exception 'loan.invalid'; end if;
  if tg_op='UPDATE' then
    if new.deleted_at is not null and exists(select 1 from public.transactions where loan_id=new.id and loan_event='repayment' and deleted_at is null) then raise exception 'loan.inUse'; end if;
    select remaining_minor into paid from public.loan_progress where id=new.id;
    if new.archived_at is not null and paid<>0 then raise exception 'loan.inUse'; end if;
  end if;
  return new;
end $$;

create function public.loan_validate_plan_input(p_input jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare field text; v numeric;
begin
  if (p_input ? 'monthlyPaymentMinor') <> (p_input ? 'paymentCount') then raise exception 'loan.invalid'; end if;
  foreach field in array array['monthlyPaymentMinor','paymentCount'] loop
    if p_input ? field and jsonb_typeof(p_input->field) <> 'null' then
      if jsonb_typeof(p_input->field) <> 'number' or (p_input->>field)!~'^\d+$' then raise exception 'loan.invalid'; end if;
      v:=(p_input->>field)::numeric;
      if v<1 or v>(case when field='paymentCount' then 1200 else 1000000000000000 end) then raise exception 'loan.invalid'; end if;
    end if;
  end loop;
  if (p_input->>'monthlyPaymentMinor' is null) <> (p_input->>'paymentCount' is null) then raise exception 'loan.invalid'; end if;
end $$;
revoke all on function public.loan_validate_plan_input(jsonb) from public, anon;
grant execute on function public.loan_validate_plan_input(jsonb) to authenticated;


create or replace function public.create_loan(p_input jsonb) returns table(id uuid) language plpgsql security invoker set search_path='' as $$
declare l public.loans; request_uuid uuid;
begin
  if auth.uid() is null or jsonb_typeof(p_input)<>'object' then raise exception 'loan.invalid'; end if;
  perform public.loan_validate_input(p_input-array['monthlyPaymentMinor','paymentCount'],array['requestId','name','direction','walletId','feeCategoryId','openedOn','creationMode'],array['principalMinor','feeBps','principalPaidBeforeMinor','feePaidBeforeMinor']);
  perform public.loan_validate_plan_input(p_input);
  request_uuid:=(p_input->>'requestId')::uuid;
  -- An advisory lock serializes only identical account/request retries; loan row
  -- locks handle financial concurrency. It grants no authorization.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_uuid::text,0));
  select * into l from public.loans where user_id=auth.uid() and request_id=request_uuid;
  if found then
    if l.request_payload<>p_input then raise exception 'loan.invalid'; end if;
    return query select l.id; return;
  end if;
  insert into public.loans(request_id,request_payload,name,direction,currency,wallet_id,fee_category_id,principal_minor,fee_bps,fee_minor,total_due_minor,creation_mode,opened_on,principal_paid_before_minor,fee_paid_before_minor,monthly_payment_minor,payment_count)
  values(request_uuid,p_input,btrim(p_input->>'name'),p_input->>'direction','USD',(p_input->>'walletId')::uuid,(p_input->>'feeCategoryId')::uuid,
    (p_input->>'principalMinor')::bigint,(p_input->>'feeBps')::integer,0,1,p_input->>'creationMode',(p_input->>'openedOn')::date,
    (p_input->>'principalPaidBeforeMinor')::bigint,(p_input->>'feePaidBeforeMinor')::bigint,(p_input->>'monthlyPaymentMinor')::bigint,(p_input->>'paymentCount')::integer) returning * into l;
  if l.creation_mode='new' then
    insert into public.transactions(kind,occurred_on,wallet_id,amount_minor,currency,note,source,loan_id,loan_event,loan_request_id,loan_payload)
    values('loan',l.opened_on,l.wallet_id,l.principal_minor,l.currency,l.name,'loan',l.id,'disbursement',request_uuid,p_input);
  end if;
  return query select l.id;
end $$;

create or replace function public.update_loan(p_id uuid,p_input jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'loan.invalid'; end if;
  perform public.loan_validate_input(p_input-array['monthlyPaymentMinor','paymentCount'],array['name','walletId','feeCategoryId'],array[]::text[]);
  perform public.loan_validate_plan_input(p_input);
  update public.loans set monthly_payment_minor=case when p_input ? 'monthlyPaymentMinor' then (p_input->>'monthlyPaymentMinor')::bigint else monthly_payment_minor end,
    payment_count=case when p_input ? 'paymentCount' then (p_input->>'paymentCount')::integer else payment_count end, name=btrim(p_input->>'name'),wallet_id=(p_input->>'walletId')::uuid,fee_category_id=(p_input->>'feeCategoryId')::uuid where id=p_id and user_id=auth.uid();
  if not found then raise exception 'loan.invalid'; end if;
end $$;
