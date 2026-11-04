-- Earned freelance income awaiting payment. Only linked receipts enter the ledger.
create table public.pending_payments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client text not null check (char_length(btrim(client)) between 1 and 60),
  project text not null check (char_length(btrim(project)) between 1 and 60),
  currency public.currency not null,
  total_minor bigint not null check (total_minor between 1 and 1000000000000000),
  due_on date check (due_on >= date '2000-01-01'),
  creation_payload jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(id,user_id)
);
create index pending_payments_owner on public.pending_payments(user_id,created_at desc);
alter table public.pending_payments enable row level security;
create policy pending_select on public.pending_payments for select using (user_id=(select auth.uid()));
create policy pending_insert on public.pending_payments for insert with check (user_id=(select auth.uid()));
create policy pending_update on public.pending_payments for update using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select,insert,update on public.pending_payments to authenticated;
revoke all on public.pending_payments from anon;

alter table public.transactions add column pending_payment_id uuid,
  add column pending_receipt_payload jsonb,
  add constraint pending_receipt_owner foreign key(pending_payment_id,user_id) references public.pending_payments(id,user_id),
  add constraint pending_receipt_shape check (
    (pending_payment_id is null and pending_receipt_payload is null) or
    (pending_payment_id is not null and pending_receipt_payload is not null and kind::text='income' and source is null)
  );
create index transactions_pending_payment on public.transactions(pending_payment_id) where pending_payment_id is not null;

create function public.pending_payments_integrity() returns trigger language plpgsql set search_path='' as $$
declare received numeric;
begin
  if new.user_id is distinct from auth.uid() then raise exception 'pending.invalid'; end if;
  if tg_op='UPDATE' then
    if old.deleted_at is not null or
      (to_jsonb(new)-array['client','project','total_minor','due_on','revision','deleted_at']) is distinct from
      (to_jsonb(old)-array['client','project','total_minor','due_on','revision','deleted_at']) then
      raise exception 'pending.conflict';
    end if;
    if new.deleted_at is not null and exists(select 1 from public.transactions where pending_payment_id=old.id) then
      raise exception 'pending.inUse';
    end if;
    select coalesce(sum(amount_minor),0) into received from public.transactions where pending_payment_id=old.id and deleted_at is null;
    if new.total_minor<received then raise exception 'pending.totalBelowPaid'; end if;
    new.revision:=old.revision+1;
  else new.revision:=1;
  end if;
  return new;
end $$;
create trigger pending_payments_integrity before insert or update on public.pending_payments
  for each row execute function public.pending_payments_integrity();

-- All ledger paths (including generic edits and revision-based Undo) serialize
-- on the job and enforce the same cap. A deleted receipt remains linked.
create function public.transactions_pending_integrity() returns trigger language plpgsql set search_path='' as $$
declare job public.pending_payments; received numeric; wallet_currency public.currency;
begin
  if tg_op='UPDATE' then
    if new.pending_payment_id is distinct from old.pending_payment_id or new.pending_receipt_payload is distinct from old.pending_receipt_payload then
      raise exception 'pending.conflict';
    end if;
  end if;
  if new.pending_payment_id is null then return new; end if;
  select * into job from public.pending_payments where id=new.pending_payment_id and user_id=auth.uid() for update;
  if not found or job.deleted_at is not null or new.user_id is distinct from auth.uid() or new.kind::text<>'income' or new.source is not null then
    raise exception 'pending.invalid';
  end if;
  select currency into wallet_currency from public.wallets where id=new.wallet_id and user_id=auth.uid();
  if wallet_currency is distinct from job.currency then raise exception 'pending.walletUnavailable'; end if;
  if new.occurred_on>public.loan_today() then raise exception 'pending.invalid'; end if;
  if new.deleted_at is null then
    select coalesce(sum(amount_minor),0) into received from public.transactions
      where pending_payment_id=job.id and deleted_at is null and id<>new.id;
    if received+new.amount_minor>job.total_minor then raise exception 'pending.exceedsRemaining'; end if;
  end if;
  return new;
end $$;
create trigger transactions_pending_integrity before insert or update on public.transactions
  for each row execute function public.transactions_pending_integrity();

create view public.pending_payment_progress with (security_invoker=true) as
select p.*, coalesce(r.received,0)::bigint as received_minor,
  (p.total_minor-coalesce(r.received,0))::bigint as remaining_minor,
  r.has_receipt_history
from public.pending_payments p left join lateral (
  select sum(t.amount_minor) filter(where t.deleted_at is null) as received, count(*)>0 as has_receipt_history
  from public.transactions t where t.pending_payment_id=p.id
) r on true;
grant select on public.pending_payment_progress to authenticated;

create function public.create_pending_payment(p_input jsonb) returns table(id uuid)
language plpgsql security invoker set search_path='' as $$
declare existing public.pending_payments; request uuid:=(p_input->>'requestId')::uuid;
begin
  if auth.uid() is null or request is null then raise exception 'pending.invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request::text,0));
  select * into existing from public.pending_payments where pending_payments.id=request;
  if found then
    if existing.creation_payload<>p_input or existing.deleted_at is not null then raise exception 'pending.conflict'; end if;
    return query select existing.id; return;
  end if;
  insert into public.pending_payments(id,client,project,currency,total_minor,due_on,creation_payload)
    values(request,btrim(p_input->>'client'),btrim(p_input->>'project'),(p_input->>'currency')::public.currency,
      (p_input->>'totalMinor')::bigint,(p_input->>'dueOn')::date,p_input);
  return query select request;
end $$;

create function public.record_pending_receipt(p_input jsonb) returns table(id uuid)
language plpgsql security invoker set search_path='' as $$
declare job public.pending_payments; existing public.transactions; request uuid:=(p_input->>'requestId')::uuid;
begin
  if auth.uid() is null or request is null then raise exception 'pending.invalid'; end if;
  select * into job from public.pending_payments where pending_payments.id=(p_input->>'paymentId')::uuid and user_id=auth.uid() for update;
  if not found or job.deleted_at is not null then raise exception 'pending.invalid'; end if;
  select * into existing from public.transactions where transactions.id=request;
  if found then
    if existing.pending_payment_id is distinct from job.id or existing.pending_receipt_payload is distinct from p_input then raise exception 'pending.conflict'; end if;
    -- A retry acknowledges the original receipt, without restoring or rewriting it.
    return query select existing.id; return;
  end if;
  if not exists(select 1 from public.wallets where wallets.id=(p_input->>'walletId')::uuid and user_id=auth.uid() and archived_at is null and currency=job.currency) then
    raise exception 'pending.walletUnavailable';
  end if;
  if not exists(select 1 from public.categories where categories.id=(p_input->>'categoryId')::uuid and user_id=auth.uid() and archived_at is null and kind::text='income') then
    raise exception 'pending.categoryUnavailable';
  end if;
  insert into public.transactions(id,kind,occurred_on,wallet_id,amount_minor,currency,category_id,note,pending_payment_id,pending_receipt_payload)
    values(request,'income',(p_input->>'occurredOn')::date,(p_input->>'walletId')::uuid,(p_input->>'amountMinor')::bigint,
      job.currency,(p_input->>'categoryId')::uuid,job.client||' · '||job.project,job.id,p_input);
  return query select request;
end $$;

create function public.update_pending_payment(p_id uuid,p_revision integer,p_input jsonb,p_delete boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or p_revision is null or p_delete is null then raise exception 'pending.invalid'; end if;
  if p_delete then
    update public.pending_payments set deleted_at=now() where id=p_id and user_id=auth.uid() and revision=p_revision and deleted_at is null;
  else
    update public.pending_payments set client=btrim(p_input->>'client'),project=btrim(p_input->>'project'),
      total_minor=(p_input->>'totalMinor')::bigint,due_on=(p_input->>'dueOn')::date
      where id=p_id and user_id=auth.uid() and revision=p_revision and deleted_at is null and currency=(p_input->>'currency')::public.currency;
  end if;
  if not found then raise exception 'pending.conflict'; end if;
end $$;

revoke execute on function public.pending_payments_integrity(), public.transactions_pending_integrity() from public,anon,authenticated;
revoke execute on function public.create_pending_payment(jsonb), public.record_pending_receipt(jsonb), public.update_pending_payment(uuid,integer,jsonb,boolean) from public,anon;
grant execute on function public.create_pending_payment(jsonb), public.record_pending_receipt(jsonb), public.update_pending_payment(uuid,integer,jsonb,boolean) to authenticated;
