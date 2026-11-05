-- Date-only corrections for every activity kind, loans included.
-- A loan row may change only its day (never its amounts); payments must stay in
-- order and inside the loan, and the first (disbursement) row moves the loan's
-- opening day with it. Everything else about loan rows stays locked.
CREATE OR REPLACE FUNCTION public.transactions_loan_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l record; w record; c record; principal_left numeric; fee_left numeric; latest_date date; is_new boolean;
begin
  if tg_op='UPDATE' and (old.kind::text='loan') is distinct from (new.kind::text='loan') then raise exception 'loan.managedTransaction'; end if;
  if new.kind::text<>'loan' then return new; end if;
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'loan.invalid'; end if;
  if (to_jsonb(new)->>'tender_minor') is not null or (to_jsonb(new)->>'change_balance_id') is not null
    or (to_jsonb(new)->>'change_minor') is not null or (to_jsonb(new)->>'change_currency') is not null
    or (to_jsonb(new)->>'change_rate_base') is not null or (to_jsonb(new)->>'change_rate_quote') is not null
    or (to_jsonb(new)->>'change_rate_numerator') is not null or (to_jsonb(new)->>'change_rate_denominator') is not null then raise exception 'loan.invalid'; end if;
  if tg_op='INSERT' and new.deleted_at is not null then raise exception 'loan.invalid'; end if;
  select * into l from public.loans where id=new.loan_id and user_id=new.user_id for update;
  if not found then raise exception 'loan.invalid'; end if;
  is_new:=tg_op='INSERT';
  if not is_new then
    if (to_jsonb(new)-array['deleted_at','updated_at','revision','occurred_on']) is distinct from (to_jsonb(old)-array['deleted_at','updated_at','revision','occurred_on']) then raise exception 'loan.managedTransaction'; end if;
    if new.occurred_on is distinct from old.occurred_on then
      -- Date-only correction: the day must stay inside the loan and keep payments in order.
      if new.deleted_at is distinct from old.deleted_at or old.deleted_at is not null then raise exception 'loan.managedTransaction'; end if;
      if l.deleted_at is not null then raise exception 'loan.loanClosed'; end if;
      if new.occurred_on<l.opened_on or new.occurred_on>public.loan_today() then raise exception 'loan.invalid'; end if;
      if new.loan_event='disbursement' then
        if new.occurred_on<>l.opened_on then raise exception 'loan.managedTransaction'; end if;
      elsif new.loan_event='repayment' then
        if exists(select 1 from public.transactions x where x.loan_id=l.id and x.loan_event='repayment' and x.deleted_at is null and x.id<>new.id
          and ((x.loan_event_seq<old.loan_event_seq and x.occurred_on>new.occurred_on)
            or (x.loan_event_seq>old.loan_event_seq and x.occurred_on<new.occurred_on))) then raise exception 'loan.paymentOrder'; end if;
      else raise exception 'loan.invalid'; end if;
      if new.deleted_at is not distinct from old.deleted_at then return new; end if;
    end if;
    if new.deleted_at is not distinct from old.deleted_at then return new; end if;
  end if;
  select * into w from ledger_private.balance_context where id=new.balance_id and user_id=new.user_id for update;
  if not found or w.currency<>l.currency then raise exception 'loan.invalid'; end if;
  if is_new and w.archived_at is not null then raise exception 'loan.invalid'; end if;
  new.currency:=l.currency;
  if new.occurred_on<l.opened_on or new.occurred_on>public.loan_today() then raise exception 'loan.invalid'; end if;
  if new.loan_event='disbursement' then
    if l.creation_mode<>'new' or (is_new and new.balance_id<>l.balance_id) or new.occurred_on<>l.opened_on
      or new.amount_minor<>l.principal_minor or (not is_new and new.deleted_at is null)
      or (new.deleted_at is not null and l.deleted_at is null) then raise exception 'loan.managedTransaction'; end if;
    new.loan_event_seq:=0; new.loan_principal_minor:=l.principal_minor; new.loan_fee_minor:=0; new.category_id:=null;
    new.loan_flow:=case when l.direction='borrowed' then 'in' else 'out' end;
  elsif new.loan_event='repayment' then
    if l.deleted_at is not null then raise exception 'loan.loanClosed'; end if;
    if not is_new and exists(select 1 from public.transactions where loan_id=l.id and loan_event='repayment' and deleted_at is null and loan_event_seq>old.loan_event_seq) then raise exception 'loan.paymentOrder'; end if;
    if new.deleted_at is not null then return new; end if;
    select l.principal_minor-l.principal_paid_before_minor-coalesce(sum(loan_principal_minor),0),
           l.fee_minor-l.fee_paid_before_minor-coalesce(sum(loan_fee_minor),0),max(occurred_on)
      into principal_left,fee_left,latest_date from public.transactions
      where loan_id=l.id and loan_event='repayment' and deleted_at is null and id<>new.id;
    if new.amount_minor<=0 or new.amount_minor>principal_left+fee_left then raise exception 'loan.exceedsRemaining'; end if;
    if new.occurred_on<latest_date then raise exception 'loan.paymentOrder'; end if;
    if not is_new and (new.loan_principal_minor<>least(new.amount_minor,principal_left) or new.loan_fee_minor<>new.amount_minor-least(new.amount_minor,principal_left)) then raise exception 'loan.paymentOrder'; end if;
    if is_new then
      select coalesce(max(loan_event_seq),0)+1 into new.loan_event_seq from public.transactions where loan_id=l.id;
      new.loan_principal_minor:=least(new.amount_minor,principal_left)::bigint;
      new.loan_fee_minor:=new.amount_minor-new.loan_principal_minor;
      new.category_id:=l.fee_category_id;
      select * into c from public.categories where id=new.category_id and user_id=new.user_id for share;
      if not found or c.archived_at is not null or c.kind::text<>(case when l.direction='borrowed' then 'expense' else 'income' end) then raise exception 'loan.invalid'; end if;
    end if;
    new.loan_flow:=case when l.direction='borrowed' then 'out' else 'in' end;
  else raise exception 'loan.invalid'; end if;
  new.source:='loan';
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.loans_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w record; c record; fee numeric; paid numeric;
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'loan.invalid'; end if;
  -- Terms and request identity cannot be rewritten after the first posting.
  if tg_op='UPDATE' then
    if (to_jsonb(new)-array['name','balance_id','fee_category_id','archived_at','deleted_at','monthly_payment_minor','payment_count','opened_on'])
       is distinct from (to_jsonb(old)-array['name','balance_id','fee_category_id','archived_at','deleted_at','monthly_payment_minor','payment_count','opened_on']) then
      raise exception 'loan.termsLocked';
    end if;
    if old.deleted_at is not null then raise exception 'loan.loanClosed'; end if;
    -- The opening day moves only with its disbursement and never past a recorded payment.
    if new.opened_on is distinct from old.opened_on and (new.creation_mode<>'new' or exists(select 1 from public.transactions x where x.loan_id=new.id and x.loan_event='repayment' and x.deleted_at is null and x.occurred_on<new.opened_on)) then raise exception 'loan.termsLocked'; end if;
  end if;
  select * into w from ledger_private.balance_context where id=new.balance_id and user_id=new.user_id for update;
  if not found then raise exception 'loan.invalid'; end if;
  if tg_op='INSERT' then new.currency:=w.currency;
  elsif w.currency<>new.currency then raise exception 'loan.invalid'; end if;
  if w.archived_at is not null and (tg_op='INSERT' or new.balance_id is distinct from old.balance_id) then raise exception 'loan.invalid'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.loan_final_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare loan_uuid uuid; l record; disbursements bigint;
begin
  if tg_table_name='loans' then
    loan_uuid:=case when tg_op='DELETE' then old.id else new.id end;
  else loan_uuid:=case when tg_op='DELETE' then old.loan_id else new.loan_id end; end if;
  if loan_uuid is null then return null; end if;
  select * into l from public.loans where id=loan_uuid for update;
  if not found then return null; end if; -- Whole-account cascade cleanup.
  select count(*) into disbursements from public.transactions where loan_id=l.id and loan_event='disbursement' and deleted_at is null;
  if (l.deleted_at is null and l.creation_mode='new' and disbursements<>1)
    or ((l.deleted_at is not null or l.creation_mode='existing') and disbursements<>0)
    or exists(select 1 from public.transactions x where x.loan_id=l.id and x.loan_event='disbursement' and x.deleted_at is null and x.occurred_on<>l.opened_on)
    or exists(select 1 from public.loan_progress where id=l.id and (principal_remaining_minor<0 or fee_remaining_minor<0 or (archived_at is not null and remaining_minor<>0))) then raise exception 'loan.invalid'; end if;
  return null;
end $function$;

create function public.set_transaction_date(p_id uuid, p_expected_revision integer, p_date date)
returns table(id uuid, revision integer)
language plpgsql security invoker set search_path = '' as $$
declare t record;
begin
  if auth.uid() is null or p_date is null or p_date < date '2000-01-01' then raise exception 'invalid transaction input'; end if;
  select * into t from public.transactions x where x.id = p_id and x.user_id = auth.uid() and x.deleted_at is null for update;
  if not found or t.revision <> p_expected_revision then raise exception 'loan.conflict'; end if;
  if t.kind::text = 'loan' and t.loan_event = 'disbursement' then
    update public.loans set opened_on = p_date where loans.id = t.loan_id and loans.user_id = auth.uid();
  end if;
  update public.transactions set occurred_on = p_date where transactions.id = p_id and transactions.user_id = auth.uid();
  return query select x.id, x.revision from public.transactions x where x.id = p_id;
end $$;
revoke execute on function public.set_transaction_date(uuid, integer, date) from public, anon;
grant execute on function public.set_transaction_date(uuid, integer, date) to authenticated;
