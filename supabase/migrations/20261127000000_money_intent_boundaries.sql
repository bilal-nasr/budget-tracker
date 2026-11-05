-- Denomination intent travels in the same PostgREST transaction as the mutation.
create function ledger_private.expected_currency_units() returns jsonb language plpgsql set search_path='' as $$
declare headers jsonb; units jsonb; begin
 begin
  headers:=nullif(current_setting('request.headers',true),'')::jsonb;
  if (headers ? 'x-budget-units') is not true then return null; end if;
  units:=(headers->>'x-budget-units')::jsonb;
  if jsonb_typeof(units) is distinct from 'object' then raise exception 'invalid'; end if;
  if (select count(*) from jsonb_each(units)) not between 1 and 64 or exists(select 1 from jsonb_each(units) e
   where e.key !~ '^[A-Z][A-Z0-9]{0,11}$' or jsonb_typeof(e.value)<>'number' or e.value::text !~ '^[0-8]$') then raise exception 'invalid'; end if;
 exception when others then raise exception using errcode='BT003',message='currency.intentConflict'; end;
 return units;
end $$;
create function ledger_private.check_currency_intent(p_owner uuid,p_codes text[],p_implicit boolean default false) returns void language plpgsql set search_path='' as $$
declare units jsonb:=ledger_private.expected_currency_units(); c public.currencies; k text; begin
 -- Never exempt SECURITY DEFINER's current_user: authenticated RPCs must check.
 if auth.uid() is null then return; end if;
 if p_owner is distinct from auth.uid() then raise exception using errcode='BT003',message='currency.intentConflict'; end if;
 perform ledger_private.lock_owner();
 if units is null then
  if p_implicit then return; end if;
  raise exception using errcode='BT003',message='currency.intentConflict';
 end if;
 -- Supplied intent is always honored, including implicit persisted configuration.
 for k in select jsonb_object_keys(units) order by 1 loop
  select * into c from public.currencies where user_id=p_owner and code=k for update;
  if not found or c.decimal_places is distinct from (units->>k)::integer then raise exception using errcode='BT003',message='currency.intentConflict'; end if;
 end loop;
 for k in select distinct x from unnest(p_codes) x where x is not null order by x loop
  if not (units ? k) then raise exception using errcode='BT003',message='currency.intentConflict'; end if;
 end loop;
end $$;
create function ledger_private.row_currency_intent(p_new jsonb,p_old jsonb,p_table text,p_op text) returns void language plpgsql set search_path='' as $$
declare owner_id uuid:=(p_new->>'user_id')::uuid; ids uuid[]:='{}'; codes text[]:='{}'; k text; implicit boolean:=false;
 fields text[]:=array['balance_id','to_balance_id','salary_balance_id','amount_minor','to_amount_minor','salary_amount_minor','tender_minor','currency','cost_currency','total_minor','paid_before_minor','monthly_minor','principal_minor','fee_minor','limit_minor','monthly_payment_minor'];
begin
 if auth.uid() is null or p_op='DELETE' then return; end if;
 if p_op='UPDATE' and (select jsonb_object_agg(key,value) from jsonb_each(p_new) where key=any(fields)) is not distinct from
  (select jsonb_object_agg(key,value) from jsonb_each(p_old) where key=any(fields)) then
  if ledger_private.expected_currency_units() is not null then perform ledger_private.check_currency_intent(owner_id,'{}'); end if;
  return;
 end if;
 foreach k in array array['balance_id','to_balance_id','salary_balance_id','change_balance_id'] loop
  if p_new->>k is not null then ids:=array_append(ids,(p_new->>k)::uuid); end if;
 end loop;
 if p_new ? 'change_balance_ids' then select ids||coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_new->'change_balance_ids','[]')); end if;
 select coalesce(array_agg(b.currency),'{}') into codes from public.wallet_balances b where b.user_id=owner_id and b.id=any(ids);
 if p_table in('budgets','pending_payments') then codes:=array_append(codes,p_new->>'currency'); end if;
 if p_new->>'cost_currency' is not null then codes:=array_append(codes,p_new->>'cost_currency'); end if;
 if cardinality(codes)=0 then return; end if;
 if p_op='INSERT' and p_table='transactions' and p_new->>'tender_minor' is null and p_new->>'cost_currency' is null and p_new->>'to_balance_id' is null and coalesce(p_new->'change_balance_ids','[]')='[]'::jsonb then
  if p_new->>'source'='fixed' and p_new->>'kind'='expense' then implicit:=exists(select 1 from public.fixed_expenses f where f.user_id=owner_id and f.id=(p_new->>'fixed_expense_id')::uuid and f.balance_id=(p_new->>'balance_id')::uuid and f.amount_minor=(p_new->>'amount_minor')::bigint);
  elsif p_new->>'source'='salary' and p_new->>'kind'='income' then implicit:=exists(select 1 from public.profiles p where p.user_id=owner_id and p.salary_balance_id=(p_new->>'balance_id')::uuid and p.salary_amount_minor=(p_new->>'amount_minor')::bigint); end if;
 end if;
 perform ledger_private.check_currency_intent(owner_id,codes,implicit);
end $$;
-- Preserve existing ownership, security, ACLs, history constraints and lock order.
do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('ledger_private.monetary_guard()'::regprocedure);
 needle:='if not changed then return new; end if;';
 if position(needle in d)=0 then raise exception 'Missing monetary guard anchor'; end if;
 execute replace(d,needle,'perform ledger_private.row_currency_intent(new_data,old_data,tg_table_name,tg_op); '||needle);
 d:=pg_get_functiondef('ledger_private.balance_guard()'::regprocedure);
 needle:='if new.opening_balance_minor<>0 then';
 if position(needle in d)=0 then raise exception 'Missing opening guard anchor'; end if;
 execute replace(d,needle,needle||' perform ledger_private.check_currency_intent(new.user_id,array[new.currency]);');
end $$;
-- Unit receipts are transactional, durable, and isolated by the authenticated owner.
create table ledger_private.currency_intent_receipts(user_id uuid not null references auth.users(id) on delete cascade,scope text not null,request_key text not null,units jsonb,primary key(user_id,scope,request_key));
revoke all on ledger_private.currency_intent_receipts from public,anon,authenticated;
create function ledger_private.bind_currency_intent(p_scope text,p_key text) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); units jsonb:=ledger_private.expected_currency_units(); prior jsonb; begin
 if owner_id is null or p_key is null then return; end if;
 perform ledger_private.lock_owner();
 select r.units into prior from ledger_private.currency_intent_receipts r where r.user_id=owner_id and r.scope=p_scope and r.request_key=p_key;
 if found then if prior is distinct from units then raise exception using errcode='BT003',message='currency.intentConflict'; end if;
 else
  perform ledger_private.check_currency_intent(owner_id,'{}',true);
  insert into ledger_private.currency_intent_receipts values(owner_id,p_scope,p_key,units);
 end if;
end $$;
-- Bind before legacy replay checks. LF/CRLF-neutral anchors retain mature RPCs.
do $$ declare r record; d text; begin
 for r in select * from (values
  ('public.save_transaction(uuid,integer,jsonb,jsonb,jsonb)','save_transaction','p_id::text||'':''||coalesce(p_expected_revision::text,''create'')'),
  ('public.create_loan(jsonb)','create_loan','p_input->>''requestId'''),
  ('public.record_loan_payment(jsonb)','record_loan_payment','p_input->>''requestId'''),
  ('public.create_pending_payment(jsonb)','create_pending_payment','p_input->>''requestId'''),
  ('public.record_pending_receipt(jsonb)','record_pending_receipt','p_input->>''requestId'''),
  ('public.record_installment_payment(uuid,uuid,uuid,bigint,date,uuid,uuid)','record_installment_payment','p_request_id::text'),
  ('public.receive_salary(uuid,uuid)','receive_salary','p_request_id::text')
 ) v(signature,scope,key_expression) loop
  d:=pg_get_functiondef(r.signature::regprocedure);
  if position('perform ledger_private.lock_owner();' in d)=0 then raise exception 'Missing RPC owner lock: %',r.signature; end if;
  execute replace(d,'perform ledger_private.lock_owner();','perform ledger_private.lock_owner(); '||format('perform ledger_private.bind_currency_intent(%L,%s);',r.scope,r.key_expression));
 end loop;
end $$;
create table ledger_private.transfer_receipts(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,payload jsonb not null,transaction_id uuid not null,revision integer not null,primary key(user_id,request_id));
revoke all on ledger_private.transfer_receipts from public,anon,authenticated;
create function ledger_private.transfer_receipt(p_request_id uuid,p_payload jsonb,p_transaction_id uuid default null,p_revision integer default null)
returns table(id uuid,revision integer) language plpgsql security definer set search_path='' as $$
declare prior ledger_private.transfer_receipts; owner_id uuid:=auth.uid(); begin
 if owner_id is null or p_request_id is null then raise exception using errcode='22023',message='invalid transaction input'; end if;
 perform ledger_private.lock_owner();
 select * into prior from ledger_private.transfer_receipts r where r.user_id=owner_id and r.request_id=p_request_id;
 if found then
  if prior.payload is distinct from p_payload then raise exception using errcode='BT003',message='transaction conflict'; end if;
  return query select prior.transaction_id,prior.revision;
 elsif p_transaction_id is not null then
  if not exists(select 1 from public.transactions t where t.id=p_transaction_id and t.user_id=owner_id and t.kind='transfer' and t.revision=p_revision) then raise exception using errcode='BT003',message='transaction conflict'; end if;
  insert into ledger_private.transfer_receipts values(owner_id,p_request_id,p_payload,p_transaction_id,p_revision);
 end if;
end $$;
create function public.record_balance_transfer(p_request_id uuid,p_occurred_on date,p_from_balance_id uuid,p_to_balance_id uuid,p_from_amount_minor bigint,p_to_amount_minor bigint,p_note text default null,p_usd_lbp_rate integer default null)
returns table(id uuid,revision integer) language plpgsql set search_path='' as $$
declare payload jsonb; prior record; b public.wallet_balances; source_code text; dest_code text; created_id uuid; created_revision integer; begin
 perform ledger_private.lock_owner();
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 payload:=jsonb_build_object('date',p_occurred_on,'from',p_from_balance_id,'to',p_to_balance_id,'sent',p_from_amount_minor,'received',p_to_amount_minor,'note',p_note,'rate',p_usd_lbp_rate,'units',ledger_private.expected_currency_units());
 select * into prior from ledger_private.transfer_receipt(p_request_id,payload);
 if found then return query select prior.id,prior.revision; return; end if;
 if p_from_amount_minor is null or p_to_amount_minor is null or p_from_amount_minor not between 1 and 1000000000000000 or p_to_amount_minor not between 1 and 1000000000000000 then raise exception using errcode='22023',message='invalid transfer amounts'; end if;
 if p_from_balance_id=p_to_balance_id then raise exception using errcode='22023',message='balance.same'; end if;
 perform ledger_private.check_currency_intent(auth.uid(),array(select wb.currency from public.wallet_balances wb where wb.user_id=auth.uid() and wb.id in(p_from_balance_id,p_to_balance_id)));
 b:=ledger_private.lock_wallet_balance(auth.uid(),p_from_balance_id,true); source_code:=b.currency;
 b:=ledger_private.lock_wallet_balance(auth.uid(),p_to_balance_id,true); dest_code:=b.currency;
 if source_code=dest_code and p_from_amount_minor<>p_to_amount_minor then raise exception using errcode='22023',message='balance.amountMismatch'; end if;
 created_id:=transaction_private.record_transfer(p_occurred_on,p_from_balance_id,p_to_balance_id,p_from_amount_minor,p_to_amount_minor,p_note,p_usd_lbp_rate);
 select t.revision into created_revision from public.transactions t where t.id=created_id and t.user_id=auth.uid();
 perform ledger_private.transfer_receipt(p_request_id,payload,created_id,created_revision);
 return query select created_id,created_revision;
end $$;
-- Legacy non-idempotent APIs are internal-only; HTTP transfers require UUIDs.
revoke execute on function public.record_balance_transfer(date,uuid,uuid,bigint,bigint,text,integer),public.record_transfer(date,uuid,uuid,bigint,bigint,text,integer) from public,anon,authenticated;
revoke all on function public.record_balance_transfer(uuid,date,uuid,uuid,bigint,bigint,text,integer) from public,anon;
grant execute on function public.record_balance_transfer(uuid,date,uuid,uuid,bigint,bigint,text,integer) to authenticated;

create or replace function public.settle_and_delete_wallet(p_request_id uuid,p_wallet_id uuid,p_settlements jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); payload jsonb:=jsonb_build_object('walletId',p_wallet_id,'settlements',p_settlements);
 receipt jsonb; entry jsonb; b public.wallet_balances; other public.wallet_balances; amount numeric; chunk bigint; direction integer; c public.currencies; headers text;
begin
 if owner_id is null or p_request_id is null or p_wallet_id is null or jsonb_typeof(p_settlements) is distinct from 'array' then raise exception 'wallet.invalidSettlement'; end if;
 perform ledger_private.lock_owner();
 select r.payload into receipt from ledger_private.deletion_receipts r where r.user_id=owner_id and r.request_id=p_request_id;
 if found then if receipt is distinct from payload then raise exception 'wallet.deletionConflict'; end if; return; end if;
 perform catalog.code from public.currencies catalog where catalog.user_id=owner_id order by catalog.code for update;
 perform 1 from public.wallets where id=p_wallet_id and user_id=owner_id and deleted_at is null for update;
 if not found then raise exception 'wallet.unavailable'; end if;
 if jsonb_array_length(p_settlements)<>(select count(*) from public.wallet_balances where wallet_id=p_wallet_id and user_id=owner_id)
  or (select count(distinct value->>'balanceId') from jsonb_array_elements(p_settlements))<>jsonb_array_length(p_settlements) then raise exception 'wallet.deletionConflict'; end if;
 if exists(select 1 from public.wallet_balances where wallet_id=p_wallet_id and ledger_private.balance_has_dependency(id)) then raise exception 'wallet.deletionConflict'; end if;
 insert into ledger_private.resolutions values(owner_id,p_wallet_id,txid_current());
 -- First pass validates the entire plan, including zero rows and all counterparts.
 for entry in select value from jsonb_array_elements(p_settlements) order by value->>'balanceId' loop
  if jsonb_typeof(entry)<>'object' or entry-array['balanceId','counterpartBalanceId','expectedAmountMinor','expectedUnit']<>'{}'
   or not(entry ?& array['balanceId','counterpartBalanceId','expectedAmountMinor','expectedUnit'])
   or jsonb_typeof(entry->'expectedAmountMinor')<>'number' or (entry->>'expectedAmountMinor') !~ '^-?[0-9]+$'
   or jsonb_typeof(entry->'expectedUnit')<>'object' or (entry->'expectedUnit')-array['code','decimalPlaces']<>'{}'
   or not((entry->'expectedUnit') ?& array['code','decimalPlaces']) then raise exception 'wallet.invalidSettlement'; end if;
  select * into b from public.wallet_balances where id=(entry->>'balanceId')::uuid and user_id=owner_id and wallet_id=p_wallet_id;
  if not found then raise exception 'wallet.deletionConflict'; end if;
  select * into c from public.currencies where user_id=owner_id and code=b.currency;
  select balance_minor into amount from public.wallet_balance_totals where balance_id=b.id and user_id=owner_id;
  if amount is null or amount is distinct from (entry->>'expectedAmountMinor')::numeric
   or b.currency is distinct from entry->'expectedUnit'->>'code'
   or to_jsonb(c.decimal_places) is distinct from entry->'expectedUnit'->'decimalPlaces' then raise exception 'wallet.deletionConflict'; end if;
  if amount=0 then
   if entry->>'counterpartBalanceId' is not null then raise exception 'wallet.invalidSettlement'; end if;
   continue;
  end if;
  b:=ledger_private.lock_wallet_balance(owner_id,b.id,true);
  other:=ledger_private.lock_wallet_balance(owner_id,(entry->>'counterpartBalanceId')::uuid,true);
  if other.wallet_id=p_wallet_id or b.currency<>other.currency then raise exception 'wallet.invalidSettlement'; end if;
 end loop;
 -- Even this internally generated path honors an explicitly supplied header.
 perform ledger_private.check_currency_intent(owner_id,'{}',true);
 -- Stamp only each leg's already-verified unit, independent of catalog size.
 headers:=current_setting('request.headers',true);
 for entry in select value from jsonb_array_elements(p_settlements) order by value->>'balanceId' loop
  amount:=(entry->>'expectedAmountMinor')::numeric;
  if amount=0 then continue; end if;
  perform set_config('request.headers',jsonb_build_object('x-budget-units',jsonb_build_object(entry->'expectedUnit'->>'code',entry->'expectedUnit'->'decimalPlaces')::text)::text,true);
  direction:=case when amount>0 then 1 else -1 end; amount:=abs(amount);
  while amount>0 loop
   chunk:=least(amount,1000000000000000)::bigint;
   if direction>0 then perform public.record_balance_transfer(public.loan_today(),(entry->>'balanceId')::uuid,(entry->>'counterpartBalanceId')::uuid,chunk,chunk,'Wallet settlement');
   else perform public.record_balance_transfer(public.loan_today(),(entry->>'counterpartBalanceId')::uuid,(entry->>'balanceId')::uuid,chunk,chunk,'Wallet settlement'); end if;
   amount:=amount-chunk;
  end loop;
 end loop;
 perform set_config('request.headers',coalesce(headers,''),true);
 perform public.delete_wallet(p_wallet_id);
 insert into ledger_private.deletion_receipts values(owner_id,p_request_id,payload);
 delete from ledger_private.resolutions where user_id=owner_id and wallet_id=p_wallet_id and transaction_id=txid_current();
end $$;
revoke all on function ledger_private.expected_currency_units(),ledger_private.check_currency_intent(uuid,text[],boolean),ledger_private.row_currency_intent(jsonb,jsonb,text,text),ledger_private.bind_currency_intent(text,text),ledger_private.transfer_receipt(uuid,jsonb,uuid,integer) from public,anon;
grant execute on function ledger_private.expected_currency_units(),ledger_private.check_currency_intent(uuid,text[],boolean),ledger_private.row_currency_intent(jsonb,jsonb,text,text),ledger_private.bind_currency_intent(text,text),ledger_private.transfer_receipt(uuid,jsonb,uuid,integer) to authenticated;
