-- Both directions, one additive fee. Principal is cash flow, never spending/income.
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_payload jsonb not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  direction text not null check (direction in ('borrowed','lent')),
  currency public.currency not null,
  wallet_id uuid not null references public.wallets(id) on delete no action deferrable initially deferred,
  fee_category_id uuid not null references public.categories(id) on delete no action deferrable initially deferred,
  principal_minor bigint not null check (principal_minor between 1 and 1000000000000000),
  fee_bps integer not null check (fee_bps between 0 and 10000),
  fee_minor bigint not null check (fee_minor between 0 and 1000000000000000),
  total_due_minor bigint not null check (total_due_minor between 1 and 1000000000000000),
  creation_mode text not null check (creation_mode in ('new','existing')),
  opened_on date not null check (opened_on >= date '2000-01-01'),
  principal_paid_before_minor bigint not null default 0 check (principal_paid_before_minor between 0 and principal_minor),
  fee_paid_before_minor bigint not null default 0 check (fee_paid_before_minor between 0 and fee_minor),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  unique(user_id,request_id),
  check (creation_mode <> 'new' or (principal_paid_before_minor=0 and fee_paid_before_minor=0)),
  check (total_due_minor=principal_minor+fee_minor)
);
create index loans_user_idx on public.loans(user_id,created_at desc);
alter table public.loans enable row level security;
create policy loans_select on public.loans for select using (user_id=(select auth.uid()));
create policy loans_insert on public.loans for insert with check (user_id=(select auth.uid()));
create policy loans_update on public.loans for update using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
-- No hard-delete policy: association/history can never be detached.

alter table public.transactions
  add column loan_id uuid references public.loans(id) on delete no action deferrable initially deferred,
  add column loan_event text,
  add column loan_flow text,
  add column loan_principal_minor bigint,
  add column loan_fee_minor bigint,
  add column loan_event_seq integer,
  add column loan_request_id uuid,
  add column loan_payload jsonb;

-- Extend the actual preceding shape/source predicates, retaining itemization,
-- cashier and salary checks. Expressions originate from pg_catalog, not input.
do $$
declare rule record;
begin
  for rule in select conname,pg_get_expr(conbin,conrelid) as expression
    from pg_constraint where conrelid='public.transactions'::regclass
      and conname in ('transactions_kind_shape','transactions_source_check')
  loop
    execute format('alter table public.transactions drop constraint %I',rule.conname);
    execute format('alter table public.transactions add constraint %I check ((%s) or (kind::text=''loan'' and source=''loan''))',rule.conname,rule.expression);
  end loop;
end $$;

alter table public.transactions add constraint transactions_loan_shape check (
  (kind::text='loan' and source='loan' and loan_id is not null
   and loan_event in ('disbursement','repayment') and loan_flow in ('in','out')
   and loan_principal_minor is not null and loan_fee_minor is not null
   and loan_principal_minor>=0 and loan_fee_minor>=0
   and amount_minor=loan_principal_minor+loan_fee_minor
   and loan_event_seq is not null and loan_event_seq>=0 and loan_request_id is not null and loan_payload is not null
   and installment_id is null and fixed_expense_id is null and to_wallet_id is null and to_amount_minor is null
   and ((loan_event='disbursement' and category_id is null and loan_fee_minor=0 and loan_event_seq=0)
     or (loan_event='repayment' and category_id is not null and loan_event_seq>0)))
  or (kind::text<>'loan' and source is distinct from 'loan' and loan_id is null and loan_event is null and loan_flow is null
   and loan_principal_minor is null and loan_fee_minor is null and loan_event_seq is null and loan_request_id is null and loan_payload is null)
);
create unique index transactions_loan_seq on public.transactions(loan_id,loan_event_seq) where loan_id is not null;
create unique index transactions_loan_disbursement on public.transactions(loan_id) where loan_event='disbursement';
create unique index transactions_loan_request on public.transactions(user_id,loan_request_id) where loan_id is not null;

create function public.loan_today() returns date language sql stable security invoker set search_path='' as $$
  select (now() at time zone coalesce((select p.timezone from public.profiles p where p.user_id=auth.uid()),'Asia/Beirut'))::date;
$$;

create view public.loan_progress with (security_invoker=true) as
select l.*,
  (l.principal_paid_before_minor+coalesce(p.principal,0))::bigint as principal_paid_minor,
  (l.fee_paid_before_minor+coalesce(p.fee,0))::bigint as fee_paid_minor,
  (l.principal_minor-l.principal_paid_before_minor-coalesce(p.principal,0))::bigint as principal_remaining_minor,
  (l.fee_minor-l.fee_paid_before_minor-coalesce(p.fee,0))::bigint as fee_remaining_minor,
  (l.total_due_minor-l.principal_paid_before_minor-l.fee_paid_before_minor-coalesce(p.principal,0)-coalesce(p.fee,0))::bigint as remaining_minor
from public.loans l left join lateral (
  select sum(t.loan_principal_minor) as principal,sum(t.loan_fee_minor) as fee
  from public.transactions t where t.loan_id=l.id and t.loan_event='repayment' and t.deleted_at is null
) p on true;

create function public.loans_integrity() returns trigger language plpgsql set search_path='' as $$
declare w record; c record; fee numeric; paid numeric;
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'loan.invalid'; end if;
  -- Terms and request identity cannot be rewritten after the first posting.
  if tg_op='UPDATE' then
    if (to_jsonb(new)-array['name','wallet_id','fee_category_id','archived_at','deleted_at'])
       is distinct from (to_jsonb(old)-array['name','wallet_id','fee_category_id','archived_at','deleted_at']) then
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
  if new.opened_on>public.loan_today() then raise exception 'loan.invalid'; end if;
  if tg_op='UPDATE' then
    if new.deleted_at is not null and exists(select 1 from public.transactions where loan_id=new.id and loan_event='repayment' and deleted_at is null) then raise exception 'loan.inUse'; end if;
    select remaining_minor into paid from public.loan_progress where id=new.id;
    if new.archived_at is not null and paid<>0 then raise exception 'loan.inUse'; end if;
  end if;
  return new;
end $$;
create trigger loans_integrity before insert or update on public.loans for each row execute function public.loans_integrity();

create function public.transactions_loan_check() returns trigger language plpgsql set search_path='' as $$
declare l record; w record; c record; principal_left numeric; fee_left numeric; latest_date date; is_new boolean;
begin
  if tg_op='UPDATE' and (old.kind::text='loan') is distinct from (new.kind::text='loan') then raise exception 'loan.managedTransaction'; end if;
  if new.kind::text<>'loan' then return new; end if;
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'loan.invalid'; end if;
  if (to_jsonb(new)->>'tender_minor') is not null or (to_jsonb(new)->>'change_wallet_id') is not null
    or (to_jsonb(new)->>'change_minor') is not null or (to_jsonb(new)->>'change_currency') is not null
    or (to_jsonb(new)->>'change_rate_base') is not null or (to_jsonb(new)->>'change_rate_quote') is not null
    or (to_jsonb(new)->>'change_rate_numerator') is not null or (to_jsonb(new)->>'change_rate_denominator') is not null then raise exception 'loan.invalid'; end if;
  if tg_op='INSERT' and new.deleted_at is not null then raise exception 'loan.invalid'; end if;
  select * into l from public.loans where id=new.loan_id and user_id=new.user_id for update;
  if not found then raise exception 'loan.invalid'; end if;
  is_new:=tg_op='INSERT';
  if not is_new then
    if (to_jsonb(new)-array['deleted_at','updated_at','revision']) is distinct from (to_jsonb(old)-array['deleted_at','updated_at','revision']) then raise exception 'loan.managedTransaction'; end if;
    if new.deleted_at is not distinct from old.deleted_at then return new; end if;
  end if;
  select * into w from public.wallets where id=new.wallet_id and user_id=new.user_id for update;
  if not found or w.currency<>l.currency then raise exception 'loan.invalid'; end if;
  if is_new and w.archived_at is not null then raise exception 'loan.invalid'; end if;
  new.currency:=l.currency;
  if new.occurred_on<l.opened_on or new.occurred_on>public.loan_today() then raise exception 'loan.invalid'; end if;
  if new.loan_event='disbursement' then
    if l.creation_mode<>'new' or (is_new and new.wallet_id<>l.wallet_id) or new.occurred_on<>l.opened_on
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
end $$;
-- Preserve the entire preceding common integrity function, including cashier
-- currency/settlement rules, and exclude only the new independently checked kind.
drop trigger transactions_integrity on public.transactions;
create trigger transactions_integrity before insert or update on public.transactions
for each row when (new.kind::text<>'loan') execute function public.transactions_integrity();
create trigger a_transactions_loan_check before insert or update on public.transactions
for each row execute function public.transactions_loan_check();

-- Keep category management's tenant/archive/parent protections. A loan's fee
-- category follows loan direction, including principal-only repayment events.
create or replace function public.category_reference_integrity()
returns trigger language plpgsql set search_path='' as $$
declare c record; is_new_reference boolean; loan_direction text;
begin
  if new.category_id is null then return new; end if;
  select id,user_id,kind,parent_id,archived_at into c from public.categories where id=new.category_id for share;
  if not found or c.user_id<>new.user_id then raise exception 'category_not_found'; end if;
  if tg_table_name='transactions' then
    if new.kind::text='loan' then
      select direction into loan_direction from public.loans where id=new.loan_id and user_id=new.user_id;
      if not found or new.loan_event<>'repayment'
        or c.kind::text<>(case when loan_direction='borrowed' then 'expense' else 'income' end)
        or new.loan_flow<>(case when loan_direction='borrowed' then 'out' else 'in' end) then
        raise exception 'category kind does not match loan direction';
      end if;
    elsif c.kind::text<>new.kind::text then raise exception 'category kind does not match transaction kind'; end if;
  elsif c.kind::text<>'expense' then raise exception 'category must be an expense category'; end if;
  if tg_table_name='budgets' then
    if c.parent_id is not null then raise exception 'budgets are for top-level expense categories'; end if;
    if c.archived_at is not null and new.limit_minor is not null then raise exception 'category_unavailable'; end if;
  else
    is_new_reference:=tg_op='INSERT';
    if tg_op='UPDATE' then is_new_reference:=new.category_id is distinct from old.category_id; end if;
    if c.archived_at is not null and is_new_reference then raise exception 'category_unavailable'; end if;
  end if;
  return new;
end $$;

create function public.loan_final_state() returns trigger language plpgsql set search_path='' as $$
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
    or exists(select 1 from public.loan_progress where id=l.id and (principal_remaining_minor<0 or fee_remaining_minor<0 or (archived_at is not null and remaining_minor<>0))) then raise exception 'loan.invalid'; end if;
  return null;
end $$;
create constraint trigger loans_final_state after insert or update or delete on public.loans deferrable initially deferred for each row execute function public.loan_final_state();
create constraint trigger transactions_loan_final_state after insert or update or delete on public.transactions deferrable initially deferred for each row execute function public.loan_final_state();

create function public.loan_validate_input(p_input jsonb,p_strings text[],p_numbers text[])
returns void language plpgsql immutable security invoker set search_path='' as $$
declare field text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or p_input-(p_strings||p_numbers)<>'{}'::jsonb then raise exception 'loan.invalid'; end if;
  foreach field in array p_strings loop
    if jsonb_typeof(p_input->field) is distinct from 'string' then raise exception 'loan.invalid'; end if;
  end loop;
  foreach field in array p_numbers loop
    if jsonb_typeof(p_input->field) is distinct from 'number' or (p_input->>field)!~'^\d+$' then raise exception 'loan.invalid'; end if;
  end loop;
end $$;

create function public.create_loan(p_input jsonb) returns table(id uuid) language plpgsql security invoker set search_path='' as $$
declare l public.loans; request_uuid uuid;
begin
  if auth.uid() is null or jsonb_typeof(p_input)<>'object' then raise exception 'loan.invalid'; end if;
  perform public.loan_validate_input(p_input,array['requestId','name','direction','walletId','feeCategoryId','openedOn','creationMode'],array['principalMinor','feeBps','principalPaidBeforeMinor','feePaidBeforeMinor']);
  request_uuid:=(p_input->>'requestId')::uuid;
  -- An advisory lock serializes only identical account/request retries; loan row
  -- locks handle financial concurrency. It grants no authorization.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_uuid::text,0));
  select * into l from public.loans where user_id=auth.uid() and request_id=request_uuid;
  if found then
    if l.request_payload<>p_input then raise exception 'loan.invalid'; end if;
    return query select l.id; return;
  end if;
  insert into public.loans(request_id,request_payload,name,direction,currency,wallet_id,fee_category_id,principal_minor,fee_bps,fee_minor,total_due_minor,creation_mode,opened_on,principal_paid_before_minor,fee_paid_before_minor)
  values(request_uuid,p_input,btrim(p_input->>'name'),p_input->>'direction','USD',(p_input->>'walletId')::uuid,(p_input->>'feeCategoryId')::uuid,
    (p_input->>'principalMinor')::bigint,(p_input->>'feeBps')::integer,0,1,p_input->>'creationMode',(p_input->>'openedOn')::date,
    (p_input->>'principalPaidBeforeMinor')::bigint,(p_input->>'feePaidBeforeMinor')::bigint) returning * into l;
  if l.creation_mode='new' then
    insert into public.transactions(kind,occurred_on,wallet_id,amount_minor,currency,note,source,loan_id,loan_event,loan_request_id,loan_payload)
    values('loan',l.opened_on,l.wallet_id,l.principal_minor,l.currency,l.name,'loan',l.id,'disbursement',request_uuid,p_input);
  end if;
  return query select l.id;
end $$;

create function public.record_loan_payment(p_input jsonb) returns table(id uuid,revision integer) language plpgsql security invoker set search_path='' as $$
declare l public.loans; t public.transactions; payment_id uuid;
begin
  if auth.uid() is null or jsonb_typeof(p_input)<>'object' then raise exception 'loan.invalid'; end if;
  perform public.loan_validate_input(p_input,array['requestId','loanId','walletId','occurredOn'],array['amountMinor']);
  select * into l from public.loans where loans.id=(p_input->>'loanId')::uuid and user_id=auth.uid() for update;
  if not found then raise exception 'loan.invalid'; end if;
  select * into t from public.transactions where user_id=auth.uid() and loan_request_id=(p_input->>'requestId')::uuid;
  if found then
    if t.loan_event<>'repayment' or t.loan_payload<>p_input then raise exception 'loan.invalid'; end if;
    -- An old create retry must never acquire a later lifecycle generation for
    -- Undo. Only the original, still-live insertion is an identical replay.
    if t.deleted_at is not null or t.revision<>1 then raise exception 'loan.conflict'; end if;
    return query select t.id,t.revision; return;
  end if;
  if l.deleted_at is not null then raise exception 'loan.loanClosed'; end if;
  insert into public.transactions(kind,occurred_on,wallet_id,amount_minor,currency,category_id,note,source,loan_id,loan_event,loan_request_id,loan_payload)
  values('loan',(p_input->>'occurredOn')::date,(p_input->>'walletId')::uuid,(p_input->>'amountMinor')::bigint,l.currency,l.fee_category_id,l.name,'loan',l.id,'repayment',(p_input->>'requestId')::uuid,p_input)
  returning transactions.id into payment_id;
  return query select x.id,x.revision from public.transactions x where x.id=payment_id and x.user_id=auth.uid();
end $$;

create function public.update_loan(p_id uuid,p_input jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'loan.invalid'; end if;
  perform public.loan_validate_input(p_input,array['name','walletId','feeCategoryId'],array[]::text[]);
  update public.loans set name=btrim(p_input->>'name'),wallet_id=(p_input->>'walletId')::uuid,fee_category_id=(p_input->>'feeCategoryId')::uuid where id=p_id and user_id=auth.uid();
  if not found then raise exception 'loan.invalid'; end if;
end $$;

create function public.void_loan_payment(p_transaction_id uuid,p_expected_revision integer) returns table(id uuid,revision integer) language plpgsql security invoker set search_path='' as $$
declare loan_uuid uuid; t public.transactions;
begin
  select x.loan_id into loan_uuid from public.transactions x where x.id=p_transaction_id and x.user_id=auth.uid() and x.loan_event='repayment';
  if not found then raise exception 'loan.invalid'; end if;
  perform 1 from public.loans x where x.id=loan_uuid and x.user_id=auth.uid() for update;
  select * into t from public.transactions x where x.id=p_transaction_id and x.user_id=auth.uid() for update;
  if p_expected_revision is null or p_expected_revision<1 or t.revision<>p_expected_revision then raise exception 'loan.conflict'; end if;
  if t.deleted_at is not null then return query select t.id,t.revision; return; end if;
  update public.loans x set archived_at=null where x.id=loan_uuid and x.archived_at is not null;
  update public.transactions x set deleted_at=now() where x.id=p_transaction_id;
  return query select x.id,x.revision from public.transactions x where x.id=p_transaction_id and x.user_id=auth.uid();
end $$;
create function public.restore_loan_payment(p_transaction_id uuid,p_expected_revision integer) returns table(id uuid,revision integer) language plpgsql security invoker set search_path='' as $$
declare loan_uuid uuid; t public.transactions;
begin
  select x.loan_id into loan_uuid from public.transactions x where x.id=p_transaction_id and x.user_id=auth.uid() and x.loan_event='repayment';
  if not found then raise exception 'loan.invalid'; end if;
  perform 1 from public.loans x where x.id=loan_uuid and x.user_id=auth.uid() for update;
  select * into t from public.transactions x where x.id=p_transaction_id and x.user_id=auth.uid() for update;
  if p_expected_revision is null or p_expected_revision<1 or t.revision<>p_expected_revision then raise exception 'loan.conflict'; end if;
  if t.deleted_at is null then return query select t.id,t.revision; return; end if;
  update public.transactions x set deleted_at=null where x.id=p_transaction_id;
  return query select x.id,x.revision from public.transactions x where x.id=p_transaction_id and x.user_id=auth.uid();
end $$;
create function public.cancel_loan(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare l public.loans;
begin
  select * into l from public.loans where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'loan.invalid'; end if;
  if l.deleted_at is not null then return; end if;
  update public.loans set deleted_at=now(),archived_at=null where id=p_id;
  update public.transactions set deleted_at=now() where loan_id=p_id and loan_event='disbursement' and deleted_at is null;
end $$;
create function public.set_loan_archived(p_id uuid,p_archived boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_archived is null or auth.uid() is null then raise exception 'loan.invalid'; end if;
  update public.loans set archived_at=case when p_archived then now() else null end where id=p_id and user_id=auth.uid();
  if not found then raise exception 'loan.invalid'; end if;
end $$;

-- Ordinary lifecycle entry points must never route a managed loan event around
-- its loan lock/order/revision rules. Acquire the cycle scope BEFORE any parent
-- row lock, then delegate ordinary writes to the preserved exact-revision API.
-- Copying its UPDATE here would undo migration 005's profile -> installment ->
-- transaction ordering and deadlock salary Undo against receive_salary retries.
create or replace function public.set_transaction_deleted(p_id uuid,p_expected_revision integer,p_deleted boolean)
returns table(id uuid,revision integer) language plpgsql security invoker set search_path='' as $$
begin
  perform cycle_private.lock_transaction_scope(p_id);
  if exists(select 1 from public.transactions t where t.id=p_id and t.user_id=auth.uid() and t.kind::text='loan') then
    raise exception 'loan.managedTransaction';
  end if;
  return query select r.id,r.revision from cycle_private.set_transaction_deleted(
    p_id,p_expected_revision,p_deleted
  ) r;
end $$;

-- Single projection for budget/report consumers: parent purchase cost (never
-- tender/change or descriptive items), and only the realized fee from loans.
create view public.reporting_entries with(security_invoker=true) as
select t.id as transaction_id,t.user_id,t.occurred_on,t.currency,t.category_id,t.kind::text as kind,t.amount_minor
from public.transactions t where t.deleted_at is null and t.kind::text in ('expense','income')
union all
select t.id,t.user_id,t.occurred_on,t.currency,t.category_id,
  case when t.loan_flow='out' then 'expense' else 'income' end,t.loan_fee_minor
from public.transactions t where t.deleted_at is null and t.kind::text='loan' and t.loan_event='repayment' and t.loan_fee_minor>0;

create or replace function public.month_category_spend(p_month date)
returns table(category_id uuid,currency public.currency,spent_minor bigint) language sql stable security invoker set search_path='' as $$
  select coalesce(c.parent_id,c.id),t.currency,sum(t.amount_minor)::bigint
  from public.reporting_entries t join public.categories c on c.id=t.category_id
  where t.kind='expense' and t.occurred_on>=date_trunc('month',p_month)::date
    and t.occurred_on<(date_trunc('month',p_month)+interval '1 month')::date
  group by coalesce(c.parent_id,c.id),t.currency;
$$;

-- jsonb access retains the same formula with or without the preceding cashier
-- columns during independent local migration testing. Their stored values are
-- used once: source tender debit and receiving change credit.
create or replace view public.wallet_balances with(security_invoker=true) as
select w.id as wallet_id,w.user_id,w.opening_balance_minor
  +coalesce((select sum(case
    when t.kind::text='income' then t.amount_minor
    when t.kind::text='loan' and t.loan_flow='in' then t.amount_minor
    when t.kind::text='expense' then -coalesce((to_jsonb(t)->>'tender_minor')::bigint,t.amount_minor)
    else -t.amount_minor end) from public.transactions t where t.wallet_id=w.id and t.deleted_at is null),0)
  +coalesce((select sum(t.to_amount_minor) from public.transactions t where t.to_wallet_id=w.id and t.kind::text='transfer' and t.deleted_at is null),0)
  +coalesce((select sum((to_jsonb(t)->>'change_minor')::bigint) from public.transactions t where (to_jsonb(t)->>'change_wallet_id')::uuid=w.id and t.kind::text='expense' and t.deleted_at is null),0) as balance_minor
from public.wallets w;

-- Add the loan-only reference guard alongside preceding wallet-role guards.
create function public.wallets_loan_currency_locked() returns trigger language plpgsql set search_path='' as $$
begin
  if new.currency<>old.currency and exists(select 1 from public.loans where wallet_id=old.id) then raise exception 'loan.inUse'; end if;
  return new;
end $$;
create trigger wallets_loan_currency_locked before update on public.wallets for each row execute function public.wallets_loan_currency_locked();

-- Deleting a salary wallet is one transaction: dependency rejection cannot
-- clear the salary and then fail on a loan/template/history FK in another call.
-- Match the cycle lock order, profile first, before taking the wallet lock.
create function public.delete_wallet(p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare caller uuid:=auth.uid(); w public.wallets;
begin
  if caller is null or p_id is null then raise exception 'wallet.invalid'; end if;
  perform 1 from public.profiles p where p.user_id=caller for update;
  if not found then raise exception 'wallet.invalid'; end if;
  select x.* into w from public.wallets x where x.id=p_id and x.user_id=caller for update;
  if not found or w.archived_at is null then raise exception 'wallet.invalid'; end if;
  -- Include soft-deleted rows and every wallet role; retained history is still
  -- history and must keep its wallet identity.
  if exists(select 1 from public.transactions t where t.wallet_id=p_id or t.to_wallet_id=p_id or t.change_wallet_id=p_id) then
    raise exception 'wallet.hasTransactions';
  end if;
  if exists(select 1 from public.fixed_expenses f where f.wallet_id=p_id)
    or exists(select 1 from public.installments i where i.wallet_id=p_id)
    or exists(select 1 from public.loans l where l.wallet_id=p_id) then
    raise exception 'wallet.inUse';
  end if;
  update public.profiles p set salary_amount_minor=null,salary_wallet_id=null
    where p.user_id=caller and p.salary_wallet_id=p_id;
  delete from public.wallets x where x.id=p_id and x.user_id=caller;
  if not found then raise exception 'wallet.invalid'; end if;
end $$;

-- Live loan templates must be reassigned before their category is archived.
-- Canceled historical references may archive but can never be hard-deleted.
create or replace function public.categories_one_level()
returns trigger language plpgsql set search_path='' as $$
declare p record;
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.user_id is distinct from old.user_id
    or new.kind is distinct from old.kind or new.parent_id is distinct from old.parent_id) then raise exception 'category_identity_immutable'; end if;
  new.name_en:=public.category_normalize_name(new.name_en);
  new.name_ar:=public.category_normalize_name(new.name_ar);
  if new.parent_id is not null then
    if new.parent_id=new.id then raise exception 'category_parent_invalid'; end if;
    select id,user_id,kind,parent_id,archived_at into p from public.categories where id=new.parent_id for share;
    if not found or p.user_id<>new.user_id or p.kind<>new.kind or p.parent_id is not null then raise exception 'category_parent_invalid'; end if;
    if p.archived_at is not null and (tg_op='INSERT' or (old.archived_at is not null and new.archived_at is null)) then raise exception 'category_unavailable'; end if;
  end if;
  if tg_op='UPDATE' and old.archived_at is null and new.archived_at is not null then
    if exists(select 1 from public.categories where parent_id=new.id)
      or exists(select 1 from public.fixed_expenses where category_id=new.id)
      or exists(select 1 from public.installments where category_id=new.id)
      or exists(select 1 from public.loans where fee_category_id=new.id and deleted_at is null) then raise exception 'category_in_use'; end if;
  end if;
  return new;
end $$;

create or replace function public.categories_delete_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
  if exists(select 1 from public.transactions where category_id=old.id)
    or exists(select 1 from public.fixed_expenses where category_id=old.id)
    or exists(select 1 from public.installments where category_id=old.id)
    or exists(select 1 from public.budgets where category_id=old.id)
    or exists(select 1 from public.categories where parent_id=old.id)
    or exists(select 1 from public.loans where fee_category_id=old.id) then raise exception 'category_in_use'; end if;
  return old;
end $$;

create or replace function public.remove_category(p_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare c record;
begin
  if auth.uid() is null then raise exception 'category_not_found'; end if;
  select id,archived_at into c from public.categories where id=p_id and user_id=(select auth.uid()) for update;
  if not found then raise exception 'category_not_found'; end if;
  if exists(select 1 from public.categories where parent_id=p_id)
    or exists(select 1 from public.fixed_expenses where category_id=p_id)
    or exists(select 1 from public.installments where category_id=p_id)
    or exists(select 1 from public.loans where fee_category_id=p_id and deleted_at is null) then raise exception 'category_in_use'; end if;
  if c.archived_at is not null then return 'archived'; end if;
  if exists(select 1 from public.transactions where category_id=p_id)
    or exists(select 1 from public.budgets where category_id=p_id)
    or exists(select 1 from public.loans where fee_category_id=p_id) then
    update public.categories set archived_at=now() where id=p_id and user_id=(select auth.uid());
    return 'archived';
  end if;
  delete from public.categories where id=p_id and user_id=(select auth.uid());
  return 'deleted';
end $$;

revoke execute on function public.loans_integrity(),public.transactions_loan_check(),public.loan_final_state(),public.wallets_loan_currency_locked() from public,anon,authenticated;
revoke execute on function public.loan_today(),public.create_loan(jsonb),public.record_loan_payment(jsonb),public.update_loan(uuid,jsonb),public.void_loan_payment(uuid,integer),public.restore_loan_payment(uuid,integer),public.cancel_loan(uuid),public.set_loan_archived(uuid,boolean) from public,anon;
grant execute on function public.loan_today(),public.create_loan(jsonb),public.record_loan_payment(jsonb),public.update_loan(uuid,jsonb),public.void_loan_payment(uuid,integer),public.restore_loan_payment(uuid,integer),public.cancel_loan(uuid),public.set_loan_archived(uuid,boolean) to authenticated;
revoke execute on function public.loan_validate_input(jsonb,text[],text[]) from public,anon;
grant execute on function public.loan_validate_input(jsonb,text[],text[]) to authenticated;
revoke execute on function public.delete_wallet(uuid) from public,anon;
grant execute on function public.delete_wallet(uuid) to authenticated;
