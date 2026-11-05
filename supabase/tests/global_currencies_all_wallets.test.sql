-- Real PostgreSQL lifecycle contracts. A missing propagation, premature used
-- marker, privilege bypass or wrong default transition must fail these tests.
begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Administrator-owned test helper simulates a faulty internal cleanup. The
-- deferred invariant must reject retaining any balance behind a null default.
create function pg_temp.break_tombstone_cleanup(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 insert into ledger_private.currency_operations values(auth.uid(),txid_current());
 update public.wallets set default_balance_id=null where id=p_id and user_id=auth.uid();
 delete from ledger_private.currency_operations where user_id=auth.uid() and transaction_id=txid_current();
 set constraints all immediate;
end $$;
insert into auth.users(id,instance_id,aud,role,email) values
 ('cf000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','global-currencies@example.test'),
 ('cf000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','global-currencies-other@example.test');
select set_config('request.jwt.claims','{"sub":"cf000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
create temp table global_ids(label text primary key,id uuid);
insert into global_ids values('a',public.create_wallet('Pocket','cash','USD',0)),('b',public.create_wallet('Bank','bank','LBP',0));
insert into global_ids select 'a-usd',default_balance_id from public.wallets where id=(select id from global_ids where label='a');
select is((select count(*) from public.wallet_balances),6::bigint,'every new wallet receives all enabled currencies');
select is((select count(*) from public.currencies where first_used_at is not null),0::bigint,'automatic zero rows are use-neutral');
select ok(not has_function_privilege('authenticated','public.add_wallet_balance(uuid,text)','execute'),'per-wallet add is unavailable');
select ok(not has_function_privilege('authenticated','public.detach_wallet_balance(uuid)','execute'),'per-wallet detach is unavailable');
select throws_ok($$insert into public.currencies(code,symbol,decimal_places) values('BYPASS','B',2)$$,'42501',null,'direct catalog insertion cannot bypass propagation');
select lives_ok($$select public.create_currency(' tok ','T',4)$$,'global creation normalizes input');
select is((select count(*) from public.wallet_balances where currency='TOK'),2::bigint,'new currency reaches both wallets');
select is((select default_balance_id from public.wallets where id=(select id from global_ids where label='a')),(select id from global_ids where label='a-usd'),'add preserves default identity');
insert into global_ids select 'a-tok',id from public.wallet_balances where wallet_id=(select id from global_ids where label='a') and currency='TOK';
select lives_ok($$select public.update_currency('TOK','RENAMED','R',6)$$,'unused automatic rows permit code and precision edit');
select is((select currency from public.wallet_balances where id=(select id from global_ids where label='a-tok')),'RENAMED','unused rename preserves exact balance ID');
select is((select decimal_places::integer from public.currencies where code='RENAMED'),6,'unused precision changes');
select throws_ok($$update public.currencies set disabled_at=now() where code='SYP'$$,'P0001','currency.lifecycleRequired','direct disable requires lifecycle RPC');
select throws_ok($$update public.currencies set code='BYPASS' where code='LBP'$$,'P0001','currency.lifecycleRequired','direct rename requires lifecycle RPC');
select throws_ok($$update public.wallet_balances set detached_at=now() where id=(select id from global_ids where label='a-usd')$$,'P0001','balance.globalCurrency','enabled balances cannot detach');
select throws_ok($$update public.wallet_balances set position=99 where id=(select id from global_ids where label='a-usd')$$,'P0001','balance.immutable','wallet-local currency order cannot diverge');
select lives_ok($$select public.set_currency_disabled('USD',true)$$,'zero default disables with a cyclic alternative');
select is((select b.currency from public.wallets w join public.wallet_balances b on b.id=w.default_balance_id where w.id=(select id from global_ids where label='a')),'RENAMED','default follows catalog order after USD');
select lives_ok($$select public.set_currency_disabled('USD',false)$$,'re-enable restores visibility');
select is((select id from public.wallet_balances where wallet_id=(select id from global_ids where label='a') and currency='USD'),(select id from global_ids where label='a-usd'),'re-enable preserves exact ID');
select is((select b.currency from public.wallets w join public.wallet_balances b on b.id=w.default_balance_id where w.id=(select id from global_ids where label='a')),'RENAMED','re-enable does not change defaults');
select lives_ok($$select public.delete_currency('RENAMED')$$,'unused deletion switches defaults and cleans zero rows');
select is((select count(*) from public.wallet_balances where currency='RENAMED'),0::bigint,'unused balances removed atomically');
select is((select b.currency from public.wallets w join public.wallet_balances b on b.id=w.default_balance_id where w.id=(select id from global_ids where label='a')),'LBP','deletion wraps to first enabled catalog entry');
select lives_ok($$select public.create_currency('OPEN','O',2)$$,'opening test definition exists');
select set_config('request.headers',jsonb_build_object('x-budget-units','{"OPEN":2}')::text,true);
select lives_ok($$insert into global_ids values('opening',public.create_wallet('Opening','cash','OPEN',-7))$$,'signed opening amount accepted');
select is((select opening_balance_minor from public.wallet_balances where wallet_id=(select id from global_ids where label='opening') and currency='OPEN'),(-7)::bigint,'opening applies to selected default only');
select is((select count(*) from public.wallet_balances where wallet_id=(select id from global_ids where label='opening') and currency<>'OPEN' and opening_balance_minor<>0),0::bigint,'all other openings remain zero');
select ok((select first_used_at is not null from public.currencies where code='OPEN'),'nonzero opening marks definition used');
select throws_ok($$select public.set_currency_disabled('OPEN',true)$$,'P0001','currency.nonzero','nonzero opening blocks disable');
select throws_ok($$select public.update_currency('OPEN','OPEN','O',3)$$,'P0001','currency.used','first monetary use locks precision');
select lives_ok($$select public.update_currency('OPEN','OPEN','New',2)$$,'used symbol remains editable');
select throws_ok($$select public.delete_currency('OPEN')$$,'P0001','currency.used','used definition cannot delete');
select lives_ok($$select public.create_currency('REF','F',2)$$,'configuration test definition exists');
select set_config('request.headers',jsonb_build_object('x-budget-units','{"REF":2}')::text,true);
select lives_ok($$update public.profiles set salary_balance_id=(select id from public.wallet_balances where wallet_id=(select id from global_ids where label='a') and currency='REF'),salary_amount_minor=5 where user_id=auth.uid()$$,'salary configuration may select automatic zero balance');
select ok((select first_used_at is not null from public.currencies where code='REF'),'balance-only configuration reference marks currency used');
select throws_ok($$select public.set_currency_disabled('REF',true)$$,'P0001','currency.inUse','future-writing salary blocks disable');
update public.profiles set salary_balance_id=null,salary_amount_minor=null where user_id=auth.uid();
select throws_ok($$select public.delete_currency('REF')$$,'P0001','currency.used','removing configuration never resets used state');
select lives_ok($$select public.create_currency('EMPTY','E',0)$$,'empty tombstone test definition exists');
insert into global_ids values('tomb',public.create_wallet('Tombstone','cash','USD',0));
select public.delete_wallet((select id from global_ids where label='tomb'));
select lives_ok($$select public.create_currency('LATER','L',0)$$,'addition after tombstone succeeds');
select is((select count(*) from public.wallet_balances where wallet_id=(select id from global_ids where label='tomb') and currency='LATER'),0::bigint,'tombstone receives no later catalog addition');
select lives_ok($$select public.delete_currency('EMPTY')$$,'unused deletion removes structurally empty tombstone rows');
select is((select count(*) from public.wallet_balances where currency='EMPTY'),0::bigint,'empty tombstone rows cleaned');
select throws_ok($$delete from public.currencies where code='LATER'$$,'42501',null,'direct catalog delete cannot bypass cleanup');
select set_config('request.jwt.claims','{"sub":"cf000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.delete_currency('LATER')$$,'P0001','currency.unavailable','catalog lifecycle remains tenant-scoped');
select public.set_currency_disabled('LBP',true);
select public.set_currency_disabled('SYP',true);
select throws_ok($$select public.set_currency_disabled('USD',true)$$,'P0001','currency.lastEnabled','last enabled currency cannot disable');
select throws_ok($$select public.delete_currency('USD')$$,'P0001','currency.lastEnabled','last enabled currency cannot delete');
-- Tombstones can lose their sole empty balance; live wallets cannot lose defaults.
insert into global_ids values('sole',public.create_wallet('Only USD','cash','USD',0));
select public.delete_wallet((select id from global_ids where label='sole'));
select lives_ok($$select public.create_currency('AFTER','A',0)$$,'new catalog entry does not populate sole-balance tombstone');
select lives_ok($$select public.delete_currency('USD')$$,'unused sole tombstone default can be removed');
select ok((select default_balance_id is null from public.wallets where id=(select id from global_ids where label='sole')),'empty tombstone has null default');
select is((select count(*) from public.wallet_balances where wallet_id=(select id from global_ids where label='sole')),0::bigint,'authorized null-default tombstone has no remaining balances');
insert into global_ids values('live',public.create_wallet('Live','cash','AFTER',0));
create function pg_temp.break_live_default() returns void language plpgsql as $$begin
 update public.wallets set default_balance_id=null where id=(select id from global_ids where label='live');
 set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.break_live_default()$$,'P0001','wallet.invalidDefault','live null default fails at commit boundary');
create function pg_temp.break_coverage() returns void language plpgsql as $$begin
 insert into public.wallets(name,kind,default_balance_id) values('Incomplete','cash',null);
 set constraints public.global_wallet_coverage immediate;
end $$;
select throws_ok($$select pg_temp.break_coverage()$$,'P0001','currency.incompleteCoverage','direct incomplete wallet creation fails at commit boundary');
-- A direct combined tombstone/default write must not bypass immutable defaults.
insert into global_ids values('direct-tomb',public.create_wallet('Direct tombstone','cash','AFTER',0));
select throws_ok($$update public.wallets set deleted_at=now(),default_balance_id=null where id=(select id from global_ids where label='direct-tomb')$$,'P0001','wallet.invalidDefault','authenticated DML cannot tombstone a nonempty wallet with a null default');
select ok((select deleted_at is null and default_balance_id is not null from public.wallets where id=(select id from global_ids where label='direct-tomb')),'rejected tombstone write preserves active state and default');
select throws_ok($$insert into public.wallets(name,kind,deleted_at,default_balance_id) values('Forged empty tombstone','cash',now(),null)$$,'P0001','wallet.invalidDefault','authenticated DML cannot insert a null-default tombstone');
insert into global_ids values('existing-tomb',public.create_wallet('Existing tombstone','cash','AFTER',0));
select public.delete_wallet((select id from global_ids where label='existing-tomb'));
select throws_ok($$update public.wallets set default_balance_id=null where id=(select id from global_ids where label='existing-tomb')$$,'P0001','wallet.invalidDefault','authenticated DML cannot null an existing tombstone default');
select throws_ok($$select pg_temp.break_tombstone_cleanup((select id from global_ids where label='existing-tomb'))$$,'P0001','wallet.invalidDefault','even internal cleanup cannot leave balances behind a null tombstone default');
select ok((select default_balance_id is not null from public.wallets where id=(select id from global_ids where label='existing-tomb')),'rejected incomplete cleanup preserves the tombstone default');
select set_config('request.jwt.claims','{"sub":"cf000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.create_currency('ROUND','R',2)$$,'round-trip history definition exists');
select set_config('request.headers',jsonb_build_object('x-budget-units','{"ROUND":2}')::text,true);
insert into public.transactions(kind,occurred_on,balance_id,currency,amount_minor,category_id)
 select k.kind::public.txn_kind,current_date,b.id,'ROUND',5,c.id
 from (values('income'),('expense'))k(kind) join public.categories c on c.kind::text=k.kind and c.parent_id is null
 cross join public.wallet_balances b where b.wallet_id=(select id from global_ids where label='a') and b.currency='ROUND'
 and c.id=(select id from public.categories where kind::text=k.kind and parent_id is null order by position,id limit 1);
select is((select balance_minor from public.wallet_balance_totals where wallet_id=(select id from global_ids where label='a') and currency='ROUND'),0::numeric,'money can return exactly to zero');
select throws_ok($$select public.delete_currency('ROUND')$$,'P0001','currency.used','zero return never erases monetary use');
select lives_ok($$select public.set_currency_disabled('ROUND',true)$$,'resolved historical zero balance disables');
select throws_ok($$select public.update_currency('ROUND','ROUND','R',3)$$,'P0001','currency.used','zero return never unlocks precision');
set constraints all immediate;
select * from finish();
rollback;
