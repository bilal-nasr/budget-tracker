-- Synthetic fixtures only. Run after both SYP migrations with supabase test db.
begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
-- Administrator-only seeding of the historical migration management state.
create function pg_temp.seed_needs_attention(p_id uuid,p_value boolean) returns void
language plpgsql security definer set search_path='' as $$ begin
 set constraints all immediate;
 set constraints public.wallet_order_guard deferred;
 alter table public.wallets disable trigger wallet_guard;
 update public.wallets set needs_attention=p_value where id=p_id and user_id=auth.uid();
 update public.wallets w set position=x.position from (select id,row_number() over(order by position,id)-1 position from public.wallets where user_id=auth.uid() and deleted_at is null and not needs_attention)x where w.id=x.id;
 set constraints public.wallet_order_guard immediate;
 alter table public.wallets enable trigger wallet_guard;
 set constraints all deferred;
end $$;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(not exists(select 1 from pg_type where typnamespace='public'::regnamespace and typname='currency'), 'currency metadata no longer depends on a static enum');
select ok(has_function_privilege('authenticated',
  'public.record_balance_transfer(uuid,date,uuid,uuid,bigint,bigint,text,integer)', 'execute'),
  'authenticated users may call record_transfer');
select ok(not has_function_privilege('anon',
  'public.record_balance_transfer(uuid,date,uuid,uuid,bigint,bigint,text,integer)', 'execute'),
  'anonymous callers cannot execute record_transfer');
select ok(not (select prosecdef from pg_proc
  where oid = 'public.record_balance_transfer(uuid,date,uuid,uuid,bigint,bigint,text,integer)'::regprocedure),
  'record_transfer runs as the caller, not the schema owner');
select ok(not has_function_privilege('authenticated', 'public.wallet_reference_lock()', 'execute')
  and not has_function_privilege('anon', 'public.wallet_reference_lock()', 'execute'),
  'the early reference-lock trigger is not callable through the API');

insert into auth.users (id, instance_id, aud, role, email) values
  ('c6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'currency-a@example.test'),
  ('c6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'currency-b@example.test');
with fixture(id,user_id,name,kind,currency) as (values ('c6200000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 'B SYP', 'cash', 'SYP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,f.user_id::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
update public.profiles set usd_lbp_rate = 72000
where user_id = 'c6000000-0000-4000-8000-000000000002';

select set_config('request.jwt.claims', '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

insert into public.categories (id, kind, name_en, name_ar, tile, color) values
  ('c6300000-0000-4000-8000-000000000001', 'expense', 'Synthetic cost', 'تكلفة تجريبية', 1, 'teal'),
  ('c6300000-0000-4000-8000-000000000002', 'income', 'Synthetic income', 'دخل تجريبي', 2, 'teal');
with fixture(id,name,kind,currency,opening_balance_minor) as (values ('c6100000-0000-4000-8000-000000000001', 'A USD', 'cash', 'USD', 10000),
  ('c6100000-0000-4000-8000-000000000002', 'A LBP', 'cash', 'LBP', 900000),
  ('c6100000-0000-4000-8000-000000000003', 'A SYP', 'cash', 'SYP', 100000),
  ('c6100000-0000-4000-8000-000000000004', 'A SYP destination', 'bank', 'SYP', 0),
  ('c6100000-0000-4000-8000-000000000005', 'Salary only', 'bank', 'SYP', 0),
  ('c6100000-0000-4000-8000-000000000006', 'Fixed only', 'bank', 'SYP', 0),
  ('c6100000-0000-4000-8000-000000000007', 'Installment only', 'bank', 'SYP', 0),
  ('c6100000-0000-4000-8000-000000000008', 'Unused', 'bank', 'SYP', 0),
  ('c6100000-0000-4000-8000-000000000009', 'Archived', 'bank', 'SYP', 0),
  ('c6100000-0000-4000-8000-000000000010', 'Incoming only', 'bank', 'SYP', 0),
  ('c6100000-0000-4000-8000-000000000011', 'Other USD', 'bank', 'USD', 0)), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then f.opening_balance_minor::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
select pg_temp.seed_needs_attention('c6100000-0000-4000-8000-000000000009',true);
update public.profiles set usd_lbp_rate = 89500, salary_amount_minor = 1250,
  salary_balance_id = 'c6100000-0000-4000-8000-000000000005';

insert into public.transactions (kind, occurred_on, balance_id, amount_minor, currency, category_id) values
  ('expense', '2026-11-04', 'c6100000-0000-4000-8000-000000000003', 1250, 'USD', 'c6300000-0000-4000-8000-000000000001'),
  ('income', '2026-11-04', 'c6100000-0000-4000-8000-000000000003', 250, 'LBP', 'c6300000-0000-4000-8000-000000000002');
select is((select count(*) from public.transactions where currency = 'SYP'), 2::bigint,
  'wallet currency replaces caller placeholders for SYP income and expense');
select is((select balance_minor::bigint from public.wallet_balance_totals
  where balance_id = 'c6100000-0000-4000-8000-000000000003'), 99000::bigint,
  'SYP balances use integer whole pounds without rescaling');
select is((select balance_minor::bigint from public.wallet_balance_totals
  where balance_id = 'c6100000-0000-4000-8000-000000000001'), 10000::bigint,
  'existing USD cents are unchanged');
select is((select balance_minor::bigint from public.wallet_balance_totals
  where balance_id = 'c6100000-0000-4000-8000-000000000002'), 900000::bigint,
  'existing whole-lira LBP balance is unchanged');

insert into public.budgets (category_id, currency, starts_month, limit_minor) values
  ('c6300000-0000-4000-8000-000000000001', 'SYP', '2026-11-01', 1250),
  ('c6300000-0000-4000-8000-000000000001', 'USD', '2026-11-01', 3000),
  ('c6300000-0000-4000-8000-000000000001', 'LBP', '2026-11-01', 900000);
select is((select count(*) from public.month_budgets('2026-11-01')), 3::bigint,
  'one category can have independent budgets in all three currencies');
select is((select spent_minor from public.month_category_spend('2026-11-01') where currency = 'SYP'),
  1250::bigint, 'SYP spending excludes income and stays in whole pounds');
insert into public.fixed_expenses (name, amount_minor, balance_id, category_id) values
  ('Synthetic fixed', 1250, 'c6100000-0000-4000-8000-000000000006', 'c6300000-0000-4000-8000-000000000001');
insert into public.installments (id, name, total_minor, monthly_minor, balance_id, category_id, currency) values
  ('c6400000-0000-4000-8000-000000000001', 'Synthetic installment', 10000, 1250,
    'c6100000-0000-4000-8000-000000000007', 'c6300000-0000-4000-8000-000000000001', 'USD');
select is((select currency::text from public.installments where id = 'c6400000-0000-4000-8000-000000000001'),
  'SYP', 'installment currency is derived from its SYP wallet');

create function pg_temp.currency_transfer(
  occurred_on date,from_wallet uuid,to_wallet uuid,from_amount bigint,to_amount bigint,
  note text default null,rate integer default null
) returns uuid language sql as $$
  select id from public.record_balance_transfer(gen_random_uuid(),occurred_on,from_wallet,to_wallet,from_amount,to_amount,note,rate);
$$;
create temp table currency_moves (name text primary key, id uuid not null);
create temp table currency_first_result as select * from public.record_balance_transfer(gen_random_uuid(),'2026-11-04',
  'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000001', 1250, 200);
insert into currency_moves select 'syp-usd',id from currency_first_result;
select is((select revision from currency_first_result),
  (select revision from public.transactions where id=(select id from currency_first_result)),
  'transfer response carries the final revision for its one inserted parent');
select is((select revision from public.transactions where id=(select id from currency_moves where name='syp-usd')),
  1,'transfer returns a parent initialized with a valid revision');
select ok((select proretset from pg_proc where oid='public.record_balance_transfer(uuid,date,uuid,uuid,bigint,bigint,text,integer)'::regprocedure),
  'transfer RPC returns one revision-bearing record set');
select is((select count(*) from public.transactions where id = (select id from currency_moves where name = 'syp-usd')),
  1::bigint, 'a manual SYP exchange records one transfer event');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000003'),
  97750::bigint, 'manual exchange removes the actual sent SYP amount');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000001'),
  10200::bigint, 'manual exchange adds the actual received USD amount');
update public.transactions set deleted_at = now() where id = (select id from currency_moves where name = 'syp-usd');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000003'),
  99000::bigint, 'soft deletion reverses the sent leg');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000001'),
  10000::bigint, 'soft deletion reverses the received leg');
update public.transactions set deleted_at = null where id = (select id from currency_moves where name = 'syp-usd');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000003'),
  97750::bigint, 'restoration reapplies the sent leg');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000001'),
  10200::bigint, 'restoration reapplies the received leg');

insert into currency_moves values
  ('usd-syp', pg_temp.currency_transfer('2026-11-04', 'c6100000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000004', 100, 500)),
  ('lbp-syp', pg_temp.currency_transfer('2026-11-04', 'c6100000-0000-4000-8000-000000000002', 'c6100000-0000-4000-8000-000000000004', 10000, 250)),
  ('syp-lbp', pg_temp.currency_transfer('2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000002', 250, 5000)),
  ('syp-syp', pg_temp.currency_transfer('2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 125, 125));
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000004'),
  875::bigint, 'all SYP destination legs retain their exact actual amounts');
select is((select usd_lbp_rate from public.profiles), 89500,
  'manual SYP exchanges leave the USD/LBP reference memo unchanged');
select is((select spent_minor from public.month_category_spend('2026-11-01') where currency = 'SYP'),
  1250::bigint, 'moves do not count as SYP spending');

insert into currency_moves values
  ('usd-lbp', pg_temp.currency_transfer('2026-11-04', 'c6100000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000002', 100, 90000, null, 90000)),
  ('lbp-usd', pg_temp.currency_transfer('2026-11-04', 'c6100000-0000-4000-8000-000000000002', 'c6100000-0000-4000-8000-000000000001', 90000, 100, null, 90000));
select is((select usd_lbp_rate from public.profiles), 90000,
  'both supported USD/LBP directions can remember their explicit reference rate');

create temp table currency_checkpoint as select
  (select count(*) from public.transactions) as event_count,
  (select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000003') as syp_balance,
  (select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000001') as usd_balance;

select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000001', 100, 100, null, 90000)$$,
  '22023', 'rate is only supported for USD/LBP exchanges', 'SYP to USD cannot submit a USD/LBP rate');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000003', 100, 100, null, 90000)$$,
  '22023', 'rate is only supported for USD/LBP exchanges', 'USD to SYP cannot submit a USD/LBP rate');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000002', 100, 100, null, 90000)$$,
  '22023', 'rate is only supported for USD/LBP exchanges', 'SYP to LBP cannot submit a USD/LBP rate');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000002', 'c6100000-0000-4000-8000-000000000003', 100, 100, null, 90000)$$,
  '22023', 'rate is only supported for USD/LBP exchanges', 'LBP to SYP cannot submit a USD/LBP rate');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 100, 100, null, 90000)$$,
  '22023', 'rate is only supported for USD/LBP exchanges', 'same-currency SYP transfer cannot submit a rate');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000011', 100, 100, null, 90000)$$,
  '22023', 'rate is only supported for USD/LBP exchanges', 'same-currency USD transfer cannot submit a rate');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 100, 99)$$,
  '22023', 'balance.amountMismatch', 'same-currency SYP legs must be equal');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000003', 100, 100)$$,
  '22023', 'balance.same', 'a wallet cannot transfer to itself');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 100, 0)$$,
  '22023', 'invalid transfer amounts', 'invalid received amount cannot produce a partial event');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', null, 100)$$,
  '22023', 'invalid transfer amounts', 'null sent amount is rejected');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 1000000000000001, 1000000000000001)$$,
  '22023', 'invalid transfer amounts', 'amounts above the ledger cap are rejected');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000002', 100, 100, null, 0)$$,
  '22023', 'invalid USD/LBP rate', 'invalid supported-pair rate is rejected before mutation');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000009', 100, 100)$$,
  'P0001', 'wallet.needsAttention', 'an archived destination is rejected');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000009', 'c6100000-0000-4000-8000-000000000003', 100, 100)$$,
  'P0001', 'wallet.needsAttention', 'an archived source is rejected');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6200000-0000-4000-8000-000000000001', 100, 100)$$,
  'P0001', 'balance.unavailable', 'a different tenant destination is indistinguishable from a missing wallet');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6200000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000003', 100, 100)$$,
  'P0001', 'balance.unavailable', 'a different tenant source is rejected');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'1999-12-31', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 100, 100)$$,
  '22023', 'invalid transfer details', 'invalid ledger date is rejected');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 100, 100, repeat('x', 141))$$,
  '22023', 'invalid transfer details', 'overlong notes are rejected');
select is((select count(*) from public.transactions), (select event_count from currency_checkpoint),
  'rejected transfers create no events');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000003'),
  (select syp_balance from currency_checkpoint), 'rejected transfers leave SYP balance unchanged');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id = 'c6100000-0000-4000-8000-000000000001'),
  (select usd_balance from currency_checkpoint), 'rejected transfers leave USD balance unchanged');
select is((select usd_lbp_rate from public.profiles), 90000,
  'rejected rate metadata leaves the memo unchanged');

insert into currency_moves values ('incoming-only', pg_temp.currency_transfer('2026-11-04',
  'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000010', 25, 25));
update public.transactions set deleted_at = now() where id = (select id from currency_moves where name = 'incoming-only');
select throws_ok($$update public.wallet_balances set currency = 'USD' where id = 'c6100000-0000-4000-8000-000000000010'$$,
  'P0001', null, 'soft-deleted incoming-only history locks currency');
select is((select currency::text from public.wallet_balances where id = 'c6100000-0000-4000-8000-000000000010'),
  'SYP', 'a rejected incoming-history currency edit preserves the stored SYP unit');
select throws_ok($$update public.wallet_balances set currency = 'USD' where id = 'c6100000-0000-4000-8000-000000000003'$$,
  'P0001', 'balance.immutable', 'outgoing history locks currency');
select throws_ok($$update public.wallet_balances set currency = 'USD' where id = 'c6100000-0000-4000-8000-000000000005'$$,
  'P0001', 'balance.immutable', 'salary-only reference locks currency');
select throws_ok($$update public.wallet_balances set currency = 'USD' where id = 'c6100000-0000-4000-8000-000000000006'$$,
  'P0001', 'balance.immutable', 'fixed-template-only reference locks currency');
select throws_ok($$update public.wallet_balances set currency = 'USD' where id = 'c6100000-0000-4000-8000-000000000007'$$,
  'P0001', 'balance.immutable', 'installment-only reference locks currency');
select throws_ok($$update public.wallet_balances set currency = 'USD' where id = 'c6100000-0000-4000-8000-000000000008'$$,'P0001','balance.immutable', 'balance currency remains an immutable identity');
select throws_ok($$update public.wallets set user_id = 'c6000000-0000-4000-8000-000000000002' where id = 'c6100000-0000-4000-8000-000000000008'$$,
  'P0001', 'wallet.immutable', 'wallet ownership stays immutable');

-- A memo failure is deliberately isolated; the actual transfer must survive.
reset role;
create function pg_temp.currency_reject_memo() returns trigger language plpgsql as $$
begin
  if new.usd_lbp_rate is distinct from old.usd_lbp_rate then
    raise exception 'synthetic memo failure';
  end if;
  return new;
end;
$$;
create trigger currency_test_reject_memo before update of usd_lbp_rate on public.profiles
  for each row execute function pg_temp.currency_reject_memo();
set local role authenticated;
select lives_ok($$insert into currency_moves values ('memo-failed', pg_temp.currency_transfer('2026-11-04',
  'c6100000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000002', 100, 90001, null, 90001))$$,
  'a reference-memo failure does not lose the actual move');
select is((select count(*) from public.transactions where id = (select id from currency_moves where name = 'memo-failed')),
  1::bigint, 'the event exists after memo failure');
select is((select usd_lbp_rate from public.profiles), 90000, 'failed memo retains its previous value');

select set_config('request.jwt.claims', '{"sub":"c6000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.wallets), 1::bigint, 'tenant B sees only its own SYP wallet');
select is((select count(*) from public.transactions), 0::bigint, 'tenant B sees no tenant A events');
select is((select count(*) from public.wallet_balances), 3::bigint, 'tenant B sees only its three global balances');
select is((select count(*) from public.fixed_expenses), 0::bigint, 'tenant B sees no tenant A SYP fixed templates');
select is((select count(*) from public.installments), 0::bigint, 'tenant B sees no tenant A SYP installments');
select is((select count(*) from public.month_budgets('2026-11-01')), 0::bigint, 'tenant B sees no tenant A budgets');
select is((select count(*) from public.month_category_spend('2026-11-01')), 0::bigint, 'tenant B sees no tenant A spending');
select is((select usd_lbp_rate from public.profiles), 72000, 'tenant B reference rate was never changed');
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6200000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000003', 100, 100)$$,
  'P0001', 'balance.unavailable', 'tenant B cannot target tenant A wallet');
select throws_ok($$insert into public.fixed_expenses(name,amount_minor,balance_id,category_id)
  select 'Synthetic foreign fixed',1250,'c6100000-0000-4000-8000-000000000003',id
  from public.categories where kind='expense' and parent_id is null order by position limit 1$$,
  'P0001', 'balance.unavailable', 'the early lock preserves fixed-template wallet ownership validation');
select throws_ok($$insert into public.installments(name,total_minor,balance_id,category_id,currency)
  select 'Synthetic foreign installment',1250,'c6100000-0000-4000-8000-000000000003',id,'SYP'
  from public.categories where kind='expense' and parent_id is null order by position limit 1$$,
  'P0001', 'balance.unavailable', 'the early lock preserves installment wallet ownership validation');
select throws_ok($$update public.profiles set salary_balance_id='c6100000-0000-4000-8000-000000000003',salary_amount_minor=1250$$,
  'P0001', 'balance.unavailable', 'the early lock preserves salary wallet ownership validation');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 100, 100)$$,
  '42501', 'authentication required', 'a role without an authenticated user cannot record money');
set local role anon;
select throws_ok($$select public.record_balance_transfer(gen_random_uuid(),'2026-11-04', 'c6100000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000004', 100, 100)$$,
  '42501', 'permission denied for function record_balance_transfer', 'anon cannot execute the transfer RPC');
reset role;
set constraints all immediate;
select * from finish();
rollback;
