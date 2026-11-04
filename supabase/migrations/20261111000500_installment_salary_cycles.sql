-- Actual salary receipts, not calendar months, define installment payment cycles.
-- Depends on round-3's canonical transactions.revision / save / lifecycle migration.
-- No existing category, cashier, itemization, revision or principal trigger is replaced.
begin;

alter table public.transactions
  add column salary_cycle_id uuid references public.transactions(id) on delete restrict,
  add column installment_override_of uuid references public.transactions(id) on delete restrict;

-- Refuse to invent financial repairs when an old source row has an invalid shape.
do $$
begin
  if exists (
    select 1 from public.transactions t
    left join public.installments i on i.id = t.installment_id
    where (t.source = 'salary' and (t.kind::text <> 'income' or t.installment_id is not null))
       or (t.installment_id is not null and (
         t.kind::text <> 'expense' or t.source is distinct from 'installment'
         or i.user_id is distinct from t.user_id
       ))
  ) then
    raise exception 'installment cycle backfill needs source repair';
  end if;
end;
$$;

-- Use immutable recording order, including deleted receipts and payments. Legacy
-- same-timestamp rows have only the UUID as a deterministic reconstruction tie-break.
-- Do not fabricate extra-payment acknowledgments for old multi-payment histories.
update public.transactions p
set salary_cycle_id = (
  select s.id from public.transactions s
  where s.user_id = p.user_id and s.source = 'salary' and s.kind::text = 'income'
    and (s.created_at,s.id) <= (p.created_at,p.id)
  order by s.created_at desc,s.id desc limit 1
)
where p.installment_id is not null;

create index transactions_salary_recorded_idx
  on public.transactions(user_id,created_at desc,id desc) where source = 'salary';
create index transactions_installment_cycle_idx
  on public.transactions(user_id,installment_id,salary_cycle_id,created_at desc,id desc)
  where installment_id is not null and deleted_at is null;
create index transactions_cycle_recording_idx
  on public.transactions(user_id,created_at desc,id desc)
  where source = 'salary' or installment_id is not null;

create function public.transactions_salary_cycle_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  caller uuid := auth.uid();
  current_cycle uuid;
  latest_payment uuid;
  last_recorded timestamptz;
  owner_timezone text;
  detached boolean := false;
begin
  if tg_op = 'UPDATE' then
    -- Only FK-driven detachment after deleting the owned template may unlink a
    -- payment. Retained orphan expenses keep their original source/cycle metadata.
    detached := old.installment_id is not null and new.installment_id is null
      and not exists (select 1 from public.installments i where i.id = old.installment_id);
    if (old.source in ('salary','installment') or new.source in ('salary','installment')
        or old.installment_id is not null or new.installment_id is not null)
       and (new.id is distinct from old.id or new.user_id is distinct from old.user_id
         or new.source is distinct from old.source or new.created_at is distinct from old.created_at
         or new.salary_cycle_id is distinct from old.salary_cycle_id
         or new.installment_override_of is distinct from old.installment_override_of
         or (new.installment_id is distinct from old.installment_id and not detached)) then
      raise exception 'installment identity cannot change';
    end if;
  end if;

  -- Cycle columns are meaningful only on new linked payment facts. Ordinary
  -- transactions cannot be preloaded with metadata then converted on update.
  if new.source is distinct from 'installment' and new.installment_id is null
     and (new.salary_cycle_id is not null or new.installment_override_of is not null) then
    raise exception 'invalid installment cycle';
  end if;
  if new.source is distinct from 'salary' and new.source is distinct from 'installment'
     and new.installment_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.deleted_at is not null then
    -- Inserting a hidden fact and restoring it would bypass the normal/again guard.
    raise exception 'invalid installment cycle';
  end if;

  if new.source = 'salary' and (new.kind::text <> 'income' or new.installment_id is not null) then
    raise exception 'salary receipts must be income';
  end if;
  if new.source = 'installment' and new.kind::text <> 'expense' then
    raise exception 'installment payments must be expenses';
  end if;
  if tg_op = 'INSERT' and (new.installment_id is not null or new.source = 'installment')
     and (new.source is distinct from 'installment' or new.installment_id is null or new.kind::text <> 'expense') then
    raise exception 'invalid installment cycle';
  end if;

  -- The parent template is already gone during FK detachment/account cleanup.
  -- Its old cycle association is retained; remaining integrity triggers still run.
  if detached then return new; end if;
  if caller is null or new.user_id is distinct from caller then
    raise exception 'invalid installment cycle';
  end if;
  select p.timezone into owner_timezone from public.profiles p
  where p.user_id = caller for update;
  if not found then raise exception 'invalid installment cycle'; end if;

  if tg_op = 'UPDATE' then
    -- Edits and canonical revision-aware delete/restore retain historical facts.
    -- Existing principal/currency/category/cashier/itemization guards still apply.
    return new;
  end if;

  -- now() is the transaction start time, which may predate a wait on this lock.
  -- Stamp a strictly increasing per-user recording time AFTER serialization.
  select t.created_at into last_recorded from public.transactions t
  where t.user_id = caller and (t.source = 'salary' or t.installment_id is not null)
  order by t.created_at desc,t.id desc limit 1;
  new.created_at := greatest(pg_catalog.clock_timestamp(),
    coalesce(last_recorded + interval '1 microsecond','-infinity'::timestamptz));

  if new.source = 'salary' then return new; end if;
  perform 1 from public.installments i
  where i.id = new.installment_id and i.user_id = caller for update;
  if not found then raise exception 'installment not found'; end if;
  if new.occurred_on > (pg_catalog.timezone(owner_timezone,pg_catalog.clock_timestamp()))::date then
    raise exception 'invalid installment date';
  end if;

  select t.id into current_cycle from public.transactions t
  where t.user_id = caller and t.source = 'salary' and t.kind::text = 'income' and t.deleted_at is null
  order by t.created_at desc,t.id desc limit 1;
  if new.salary_cycle_id is distinct from current_cycle then
    raise exception 'salary cycle changed';
  end if;
  select t.id into latest_payment from public.transactions t
  where t.user_id = caller and t.installment_id = new.installment_id and t.deleted_at is null
    and t.salary_cycle_id is not distinct from current_cycle
  order by t.created_at desc,t.id desc limit 1;
  if new.installment_override_of is null then
    if latest_payment is not null then raise exception 'already paid this cycle'; end if;
  elsif new.installment_override_of is distinct from latest_payment then
    raise exception 'installment payment changed';
  end if;
  return new;
end;
$$;

-- Alphabetically before transactions_installment_check: profile -> installment
-- is the normal lock order. Direct row updates racing RPCs may safely abort with
-- a deadlock; neither path may partially commit or silently retry with a new ID.
create trigger transactions_00_cycle_guard before insert or update on public.transactions
for each row execute function public.transactions_salary_cycle_guard();
revoke execute on function public.transactions_salary_cycle_guard() from public,anon,authenticated;

create function public.receive_salary(p_request_id uuid,p_expected_cycle_id uuid)
returns table(id uuid,revision integer)
language plpgsql security invoker set search_path = '' as $$
declare
  caller uuid := auth.uid();
  profile_row public.profiles%rowtype;
  previous public.transactions%rowtype;
  current_cycle uuid;
  salary_currency public.currency;
  salary_category uuid;
  inserted_id uuid;
begin
  if caller is null or p_request_id is null then raise exception 'invalid salary request'; end if;
  select p.* into profile_row from public.profiles p where p.user_id = caller for update;
  if not found then raise exception 'invalid salary request'; end if;
  select t.* into previous from public.transactions t where t.id = p_request_id and t.user_id = caller for update;
  if found then
    -- A changed/deleted fact must be reconciled; never adopt its newer revision
    -- for an old create Undo. Current salary configuration is not replay input.
    if previous.source is distinct from 'salary' or previous.kind::text <> 'income'
       or previous.deleted_at is not null or previous.revision <> 1 then
      raise exception 'transaction request already used';
    end if;
    return query select previous.id,previous.revision;
    return;
  end if;
  -- A conflicting foreign UUID is not visible through RLS; do not disclose it.
  if profile_row.salary_amount_minor is null or profile_row.salary_wallet_id is null then
    raise exception 'salary not configured';
  end if;
  select t.id into current_cycle from public.transactions t
  where t.user_id = caller and t.source = 'salary' and t.kind::text = 'income' and t.deleted_at is null
  order by t.created_at desc,t.id desc limit 1;
  if p_expected_cycle_id is distinct from current_cycle then raise exception 'salary cycle changed'; end if;
  select w.currency into salary_currency from public.wallets w
  where w.id = profile_row.salary_wallet_id and w.user_id = caller and w.archived_at is null;
  if not found then raise exception 'salary wallet not found or archived'; end if;
  select c.id into salary_category from public.categories c
  where c.user_id = caller and c.kind::text = 'income' and c.parent_id is null and c.archived_at is null
  -- Category names are editable; the first active income root remains stable
  -- after a rename, and archived/child categories are never selected.
  order by c.position,c.id limit 1;
  if salary_category is null then raise exception 'salary category not found'; end if;
  insert into public.transactions(id,user_id,kind,occurred_on,wallet_id,amount_minor,currency,category_id,note,source)
  values (p_request_id,caller,'income',pg_catalog.timezone(profile_row.timezone,pg_catalog.clock_timestamp())::date,
    profile_row.salary_wallet_id,profile_row.salary_amount_minor,salary_currency,salary_category,'Salary','salary')
  on conflict on constraint transactions_pkey do nothing returning transactions.id into inserted_id;
  if inserted_id is null then raise exception 'transaction request already used'; end if;
  return query select t.id,t.revision from public.transactions t where t.id = inserted_id and t.user_id = caller;
end;
$$;

create function public.record_installment_payment(
  p_request_id uuid,p_installment_id uuid,p_wallet_id uuid,p_amount_minor bigint,p_occurred_on date,
  p_salary_cycle_id uuid,p_override_of_transaction_id uuid
)
returns table(id uuid,revision integer)
language plpgsql security invoker set search_path = '' as $$
declare
  caller uuid := auth.uid();
  item public.installments%rowtype;
  previous public.transactions%rowtype;
  wallet_currency public.currency;
  inserted_id uuid;
begin
  if caller is null or p_request_id is null or p_installment_id is null or p_wallet_id is null
     or p_amount_minor is null or p_amount_minor not between 1 and 1000000000000000
     or p_occurred_on is null or p_occurred_on < date '2000-01-01' then
    raise exception 'invalid installment payment';
  end if;
  perform 1 from public.profiles p where p.user_id = caller for update;
  if not found then raise exception 'invalid installment payment'; end if;
  -- Normal mutation paths always lock profile -> installment -> transaction.
  -- A missing template still permits inspecting a reused request to reject it
  -- specifically; it never permits a new detached payment.
  select i.* into item from public.installments i where i.id = p_installment_id and i.user_id = caller for update;
  select t.* into previous from public.transactions t where t.id = p_request_id and t.user_id = caller for update;
  if found then
    if previous.source is distinct from 'installment' or previous.kind::text <> 'expense'
       or previous.installment_id is distinct from p_installment_id or previous.wallet_id is distinct from p_wallet_id
       or previous.amount_minor is distinct from p_amount_minor or previous.occurred_on is distinct from p_occurred_on
       or previous.salary_cycle_id is distinct from p_salary_cycle_id
       or previous.installment_override_of is distinct from p_override_of_transaction_id
       or previous.deleted_at is not null or previous.revision <> 1 then
      raise exception 'transaction request already used';
    end if;
    return query select previous.id,previous.revision;
    return;
  end if;
  if item.id is null then raise exception 'installment not found'; end if;
  select w.currency into wallet_currency from public.wallets w
  where w.id = p_wallet_id and w.user_id = caller and w.archived_at is null;
  if not found then raise exception 'wallet not found or archived'; end if;
  if wallet_currency <> item.currency then raise exception 'wallet currency does not match the installment'; end if;
  insert into public.transactions(
    id,user_id,kind,occurred_on,wallet_id,amount_minor,currency,category_id,note,source,
    installment_id,salary_cycle_id,installment_override_of
  ) values (
    p_request_id,caller,'expense',p_occurred_on,p_wallet_id,p_amount_minor,wallet_currency,item.category_id,item.name,
    'installment',item.id,p_salary_cycle_id,p_override_of_transaction_id
  ) on conflict on constraint transactions_pkey do nothing returning transactions.id into inserted_id;
  if inserted_id is null then raise exception 'transaction request already used'; end if;
  return query select t.id,t.revision from public.transactions t where t.id = inserted_id and t.user_id = caller;
end;
$$;

-- A single SQL SELECT shares the same statement snapshot across every subquery.
-- RLS remains active, and the app computes integer principal/cycle progress from
-- these live facts. Returning an empty receipt never means an empty payment list.
create function public.installment_cycle_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'receipt',(
      select jsonb_build_object('id',t.id,'occurred_on',t.occurred_on,'created_at',t.created_at,'revision',t.revision)
      from public.transactions t where t.user_id = auth.uid() and t.source = 'salary'
        and t.kind::text = 'income' and t.deleted_at is null
      order by t.created_at desc,t.id desc limit 1
    ),
    'installments',coalesce((
      select jsonb_agg(to_jsonb(i) - 'user_id' order by i.position,i.created_at,i.id)
      from public.installments i where i.user_id = auth.uid()
    ),'[]'::jsonb),
    'payments',coalesce((
      -- Carry the real parent, not a payment-shaped subset. History opens this
      -- same revision/items/name/source/settlement snapshot in the shared editor.
      -- to_jsonb(t) also retains columns introduced by later cashier/loan work.
      select jsonb_agg((to_jsonb(t) - 'user_id') || jsonb_build_object(
        'expense_items',coalesce((
          select jsonb_agg(jsonb_build_object('id',e.id,'description',e.description,
            'amount_minor',e.amount_minor,'position',e.position) order by e.position,e.id)
          from public.expense_items e where e.transaction_id = t.id and e.user_id = t.user_id
        ),'[]'::jsonb)
      ) order by t.created_at desc,t.id desc)
      from public.transactions t join public.installments i on i.id = t.installment_id and i.user_id = t.user_id
      where t.user_id = auth.uid() and t.deleted_at is null
    ),'[]'::jsonb)
  );
$$;

-- Template deletion uses the normal lock order before ON DELETE SET NULL touches
-- retained parent transactions. It does not replace transaction delete/restore.
create function public.delete_installment(p_installment_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or p_installment_id is null then raise exception 'installment not found'; end if;
  perform 1 from public.profiles p where p.user_id = auth.uid() for update;
  delete from public.installments i where i.id = p_installment_id and i.user_id = auth.uid();
  if not found then raise exception 'installment not found'; end if;
end;
$$;

-- Extend the ACTUAL preceding canonical implementations, including cashier's
-- fifth argument, without copying their validation/replay/revision logic. These
-- functions are not in an exposed API schema. Authenticated execute is needed
-- because the public wrappers and private implementations are all invoker-mode.
create schema cycle_private;
revoke all on schema cycle_private from public,anon;
grant usage on schema cycle_private to authenticated;

create function cycle_private.lock_transaction_scope(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  caller uuid := auth.uid();
  linked_installment uuid;
begin
  if caller is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_id is null then raise exception using errcode='22023',message='invalid transaction input'; end if;
  perform 1 from public.profiles p where p.user_id = caller for update;
  if not found then raise exception using errcode='BT003',message='transaction conflict'; end if;
  -- This read deliberately does not acquire a transaction lock first. Source
  -- identity is immutable; authorized template deletion also takes the profile.
  select t.installment_id into linked_installment from public.transactions t
  where t.id = p_id and t.user_id = caller;
  if linked_installment is not null then
    perform 1 from public.installments i where i.id = linked_installment and i.user_id = caller for update;
    if not found then raise exception using errcode='BT003',message='transaction conflict'; end if;
  end if;
end;
$$;

alter function public.save_transaction(uuid,integer,jsonb,jsonb,jsonb) set schema cycle_private;
alter function public.set_transaction_deleted(uuid,integer,boolean) set schema cycle_private;
revoke execute on function cycle_private.lock_transaction_scope(uuid),
  cycle_private.save_transaction(uuid,integer,jsonb,jsonb,jsonb),
  cycle_private.set_transaction_deleted(uuid,integer,boolean) from public,anon;
grant execute on function cycle_private.lock_transaction_scope(uuid),
  cycle_private.save_transaction(uuid,integer,jsonb,jsonb,jsonb),
  cycle_private.set_transaction_deleted(uuid,integer,boolean) to authenticated;

create function public.save_transaction(
  p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb,p_settlement jsonb default null
) returns table(id uuid,revision integer)
language plpgsql security invoker set search_path = '' as $$
begin
  -- Preserve itemization's required-input contract before either profile or
  -- parent lookup. In particular, a null create UUID is invalid input (22023),
  -- not a missing transaction/conflict from a later wrapper implementation.
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_id is null or (p_expected_revision is not null and p_expected_revision < 1)
     or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  perform cycle_private.lock_transaction_scope(p_id);
  return query select r.id,r.revision from cycle_private.save_transaction(
    p_id,p_expected_revision,p_input,p_items,p_settlement
  ) r;
end;
$$;

create function public.set_transaction_deleted(p_id uuid,p_expected_revision integer,p_deleted boolean)
returns table(id uuid,revision integer)
language plpgsql security invoker set search_path = '' as $$
begin
  perform cycle_private.lock_transaction_scope(p_id);
  -- Preserve exact revision comparison, even for same-state requests. In
  -- particular, expected+1 must NEVER be interpreted as proof of a lost reply.
  return query select r.id,r.revision from cycle_private.set_transaction_deleted(
    p_id,p_expected_revision,p_deleted
  ) r;
end;
$$;

revoke execute on function public.receive_salary(uuid,uuid) from public,anon;
revoke execute on function public.record_installment_payment(uuid,uuid,uuid,bigint,date,uuid,uuid) from public,anon;
revoke execute on function public.installment_cycle_snapshot() from public,anon;
revoke execute on function public.delete_installment(uuid) from public,anon;
grant execute on function public.receive_salary(uuid,uuid) to authenticated;
grant execute on function public.record_installment_payment(uuid,uuid,uuid,bigint,date,uuid,uuid) to authenticated;
grant execute on function public.installment_cycle_snapshot() to authenticated;
grant execute on function public.delete_installment(uuid) to authenticated;
revoke execute on function public.save_transaction(uuid,integer,jsonb,jsonb,jsonb),
  public.set_transaction_deleted(uuid,integer,boolean) from public,anon;
grant execute on function public.save_transaction(uuid,integer,jsonb,jsonb,jsonb),
  public.set_transaction_deleted(uuid,integer,boolean) to authenticated;

commit;
