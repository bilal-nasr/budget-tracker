-- Rollback-only catalog, exact-balance, lifecycle, ownership and ledger contracts.
-- Populated forward-migration preservation is rehearsed by multi-wallet-migration.mjs.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Removing tenant bootstrap or changing precision would reinterpret amounts.
insert into auth.users (id, instance_id, aud, role, email) values
  ('cb000000-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'multi-wallet-contract-a@example.test'),
  ('cb000000-0000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'multi-wallet-contract-b@example.test');

select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  $$select code, symbol, decimal_places::integer from public.currencies order by code$$,
  $$values ('LBP'::text, 'LBP'::text, 0), ('SYP', 'SYP', 0), ('USD', '$', 2)$$,
  'new users receive exactly the three defaults with unchanged minor-unit precision');
select is((select count(*) from public.currencies where disabled_at is not null),
  0::bigint, 'bootstrapped defaults are enabled');
select is((select count(*) from public.currencies
  where user_id = 'cb000000-0000-4000-8000-000000000002'),
  0::bigint, 'tenant A cannot read tenant B currency definitions');

-- Custom precision is runtime metadata; it must survive tenant isolation.
select public.create_currency('TOKEN8','T',8);
select results_eq(
  $$select code, symbol, decimal_places::integer from public.currencies where code = 'TOKEN8'$$,
  $$values ('TOKEN8'::text, 'T'::text, 8)$$,
  'an owner can create a custom currency with eight decimal places');

select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.currencies where code = 'TOKEN8'),
  0::bigint, 'tenant B cannot read tenant A custom currency');
select results_eq(
  $$select code, symbol, decimal_places::integer from public.currencies order by code$$,
  $$values ('LBP'::text, 'LBP'::text, 0), ('SYP', 'SYP', 0), ('USD', '$', 2)$$,
  'tenant B retains its independent default catalog');

select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temp table wallet_contract_ids(label text primary key,id uuid);
insert into wallet_contract_ids values ('pocket',public.create_wallet('Pocket','cash','USD',100));
insert into wallet_contract_ids select 'usd',default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='pocket');
insert into wallet_contract_ids values ('lbp',(select id from public.wallet_balances where wallet_id=(select id from wallet_contract_ids where label='pocket') and currency='LBP'));
insert into wallet_contract_ids values ('bank',public.create_wallet('Bank','bank','USD',0));
insert into wallet_contract_ids select 'bank-usd',default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='bank');
select is((select balance_minor from public.wallet_balance_totals where balance_id=(select id from wallet_contract_ids where label='usd')),100::numeric,'opening amount is retained exactly');
select throws_ok($$select public.record_balance_transfer('2026-11-05',(select id from wallet_contract_ids where label='usd'),(select id from wallet_contract_ids where label='usd'),1,1)$$,'22023','balance.same','same exact balance is rejected');
select lives_ok($$select public.record_balance_transfer('2026-11-05',(select id from wallet_contract_ids where label='usd'),(select id from wallet_contract_ids where label='lbp'),10,9000)$$,'same-wallet Exchange uses independent currency legs');
select throws_ok($$select public.record_balance_transfer('2026-11-05',(select id from wallet_contract_ids where label='usd'),(select id from wallet_contract_ids where label='bank-usd'),10,11)$$,'22023','balance.amountMismatch','same-currency Move requires equal amounts');
select lives_ok($$select public.record_balance_transfer('2026-11-05',(select id from wallet_contract_ids where label='usd'),(select id from wallet_contract_ids where label='bank-usd'),10,10)$$,'different-wallet Move preserves exact currency');
select throws_ok($$select public.detach_wallet_balance((select id from wallet_contract_ids where label='lbp'))$$,'42501',null,'per-wallet detach cannot be executed');
select throws_ok($$select public.delete_wallet((select id from wallet_contract_ids where label='bank'))$$,'P0001','wallet.nonzero','nonzero wallet cannot tombstone without settlement');
select throws_ok($$select public.set_wallet_default((select id from wallet_contract_ids where label='pocket'),(select id from wallet_contract_ids where label='bank-usd'))$$,'P0001','wallet.invalidDefault','default cannot refer to another wallet');
select throws_ok($$select public.set_currency_disabled('USD',true)$$,'P0001','currency.nonzero','global disable cannot strand any balance');
insert into wallet_contract_ids values ('zero',public.create_wallet('Zero','cash','SYP',0));
insert into wallet_contract_ids select 'zero-syp',default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='zero');
insert into wallet_contract_ids values ('zero-usd',(select id from public.wallet_balances where wallet_id=(select id from wallet_contract_ids where label='zero') and currency='USD'));
select lives_ok($$select public.set_currency_disabled('SYP',true)$$,'zero defaults switch before global disable');
select is((select default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='zero')),(select id from wallet_contract_ids where label='zero-usd'),'disable selects next eligible addition');
select throws_ok($$select public.record_balance_transfer('2026-11-05',(select id from wallet_contract_ids where label='zero-syp'),(select id from wallet_contract_ids where label='lbp'),1,1)$$,'P0001','currency.disabled','disabled balances reject new monetary writes');
select throws_ok($$select public.detach_wallet_balance((select id from wallet_contract_ids where label='zero-syp'))$$,'42501',null,'disabled rows are retained without per-wallet detach');
select lives_ok($$select public.delete_wallet((select id from wallet_contract_ids where label='zero'))$$,'zero wallet tombstones');
select ok((select deleted_at is not null from public.wallets where id=(select id from wallet_contract_ids where label='zero')),'tombstoned wallet identity remains readable');
select is((select count(*) from public.wallet_balances b left join public.wallets w on (w.id,w.user_id)=(b.wallet_id,b.user_id) where w.id is null),0::bigint,'every balance retains its owned container');
insert into wallet_contract_ids values ('debt',public.create_wallet('Debt','card','USD',-25));
insert into wallet_contract_ids select 'debt-usd',default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='debt');
select lives_ok($$select public.settle_and_delete_wallet('cb900000-0000-4000-8000-000000000001',(select id from wallet_contract_ids where label='debt'),jsonb_build_array(jsonb_build_object('balanceId',(select id from wallet_contract_ids where label='debt-usd'),'counterpartBalanceId',(select id from wallet_contract_ids where label='usd'))))$$,'negative deletion settlement transfers money INTO the indebted wallet');
select is((select balance_minor from public.wallet_balance_totals where balance_id=(select id from wallet_contract_ids where label='debt-usd')),0::numeric,'negative balance settles exactly to zero');
select is((select balance_minor from public.wallet_balance_totals where balance_id=(select id from wallet_contract_ids where label='usd')),55::numeric,'counterpart pays the full 25 minor-unit debt');
select lives_ok($$select public.settle_and_delete_wallet('cb900000-0000-4000-8000-000000000001',(select id from wallet_contract_ids where label='debt'),jsonb_build_array(jsonb_build_object('balanceId',(select id from wallet_contract_ids where label='debt-usd'),'counterpartBalanceId',(select id from wallet_contract_ids where label='usd'))))$$,'settlement request replay does not transfer twice');
select throws_ok($$update public.transactions set deleted_at=now() where to_balance_id=(select id from wallet_contract_ids where label='debt-usd')$$,'P0001','wallet.deleted','tombstoned monetary history cannot be deleted');
select lives_ok($$update public.transactions set note='Historical correction' where to_balance_id=(select id from wallet_contract_ids where label='debt-usd')$$,'tombstoned metadata remains editable');
select throws_ok($$select public.update_currency('USD','USD','$',3)$$,'P0001','currency.used','first-use precision is permanently locked');
select lives_ok($$update public.currencies set symbol='US$' where code='USD'$$,'used currency symbol remains editable');
select throws_ok($$select public.delete_currency('USD')$$,'P0001','currency.used','used currency cannot be deleted');
select lives_ok($$select public.delete_currency('TOKEN8')$$,'unused custom definition can be deleted');
select is((select to_wallet_name_snapshot from public.transactions where to_balance_id=(select id from wallet_contract_ids where label='debt-usd')),'Debt','settlement preserves the destination name snapshot');
update public.wallets set name='Purse' where id=(select id from wallet_contract_ids where label='pocket');
select is((select wallet_name_snapshot from public.transactions where to_balance_id=(select id from wallet_contract_ids where label='debt-usd')),'Pocket','renaming a live container does not rewrite recorded names');
select public.create_currency('HIST','H',3);
insert into wallet_contract_ids values('hist',public.create_wallet('History','cash','HIST',0));
insert into wallet_contract_ids select 'hist-balance',default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='hist');
select (select id from public.wallet_balances where wallet_id=(select id from wallet_contract_ids where label='hist') and currency='LBP');
insert into public.transactions(id,kind,occurred_on,balance_id,currency,amount_minor,category_id)
select 'cba00000-0000-4000-8000-000000000001','income','2026-11-05',(select id from wallet_contract_ids where label='hist-balance'),'HIST',5,id from public.categories where kind='income' and parent_id is null order by position limit 1;
insert into public.transactions(id,kind,occurred_on,balance_id,currency,amount_minor,category_id)
select 'cba00000-0000-4000-8000-000000000002','expense','2026-11-05',(select id from wallet_contract_ids where label='hist-balance'),'HIST',5,id from public.categories where kind='expense' and parent_id is null order by position limit 1;
select lives_ok($$select public.set_currency_disabled('HIST',true)$$,'zero historical currency disables');
select throws_ok($$update public.transactions set deleted_at=now() where id='cba00000-0000-4000-8000-000000000002'$$,'P0001','currency.disabled','disabled history cannot mutate its zero ledger');
select lives_ok($$update public.transactions set note='Historical note' where id='cba00000-0000-4000-8000-000000000002'$$,'disabled historical metadata stays editable');
select public.set_currency_disabled('HIST',false);
select throws_ok($$select public.detach_wallet_balance((select id from wallet_contract_ids where label='hist-balance'))$$,'42501',null,'historical zero rows remain globally attached');
select is((select count(*) from public.wallet_balances where currency='HIST' and detached_at is not null),0::bigint,'re-enabled history has no detached balances');
select is((select id from public.wallet_balances where wallet_id=(select id from wallet_contract_ids where label='hist') and currency='HIST'),(select id from wallet_contract_ids where label='hist-balance'),'re-enabled currency retains the exact historical balance ID');
select throws_ok($$update public.wallet_balances set opening_balance_minor=10 where id=(select id from wallet_contract_ids where label='hist-balance')$$,'P0001','balance.immutable','restoration cannot rewrite historical opening amount');
select throws_ok($$insert into public.wallet_balances(wallet_id,currency,position) values((select id from wallet_contract_ids where label='pocket'),'USD',99)$$,'23505',null,'a currency has only one historical balance identity per wallet');
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into wallet_contract_ids values('foreign-wallet',public.create_wallet('Foreign','cash','USD',0));
insert into wallet_contract_ids select 'foreign-balance',default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='foreign-wallet');
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.set_wallet_default((select id from wallet_contract_ids where label='pocket'),(select id from wallet_contract_ids where label='foreign-balance'))$$,'P0001','balance.unavailable','foreign balance cannot become a wallet default');
create function pg_temp.break_wallet_order() returns void language plpgsql as $$begin
 update public.wallets set position=99 where id=(select id from wallet_contract_ids where label='pocket');
 set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.break_wallet_order()$$,'P0001','wallet.reorderConflict','direct DML cannot leave a gap in owner wallet order');
set constraints all deferred;
insert into wallet_contract_ids values('large',public.create_wallet('Large','cash','USD',1000000000000000));
insert into wallet_contract_ids select 'large-balance',default_balance_id from public.wallets where id=(select id from wallet_contract_ids where label='large');
insert into public.transactions(kind,occurred_on,balance_id,currency,amount_minor,category_id)
select 'income','2026-11-05',(select id from wallet_contract_ids where label='large-balance'),'USD',1000000000000000,id from public.categories where kind='income' and parent_id is null order by position limit 1;
select lives_ok($$select public.settle_and_delete_wallet('cb900000-0000-4000-8000-000000000002',(select id from wallet_contract_ids where label='large'),jsonb_build_array(jsonb_build_object('balanceId',(select id from wallet_contract_ids where label='large-balance'),'counterpartBalanceId',(select id from wallet_contract_ids where label='usd'))))$$,'full settlement supports a total larger than the per-transaction amount bound');
select is((select balance_minor from public.wallet_balance_totals where balance_id=(select id from wallet_contract_ids where label='large-balance')),0::numeric,'large balance is fully settled without rescaling');
insert into public.budgets(category_id,currency,starts_month,limit_minor)
select id,'HIST','2026-01-01',100 from public.categories where kind='expense' and parent_id is null order by position limit 1;
select throws_ok($$select public.set_currency_disabled('HIST',true)$$,'P0001','currency.inUse','active budget blocks global disable');
insert into public.budgets(category_id,currency,starts_month,limit_minor)
select id,'HIST','2026-02-01',null from public.categories where kind='expense' and parent_id is null order by position limit 1;
select lives_ok($$select public.set_currency_disabled('HIST',true)$$,'a canceled historical budget does not block global disable');
set constraints all immediate;
select lives_ok($$select public.create_wallet('Immediate caller','cash','USD',0)$$,'container creation remains atomic for callers with immediate constraints');
set constraints all deferred;
reset role;
select ok(not exists(select 1 from pg_type where typnamespace='public'::regnamespace and typname='currency'),'currency enum has no remaining dependency');
set constraints all immediate;
select * from finish();
rollback;
