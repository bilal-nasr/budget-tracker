/** Populated forward migration rehearsal on an isolated database inside the
 * explicitly selected disposable PG17 container. Never reads application env. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const container=process.env.MULTI_WALLET_TEST_DOCKER_CONTAINER;
if(process.env.MULTI_WALLET_TEST_ALLOW_FIXTURES!=='1'||container!=='supabase_db_CODEX-BUDGET-MULTIWALLET-SYSTEM-20261105') throw new Error('Explicit designated disposable PG17 fixture required');
const database=`multiwallet_rehearsal_${randomUUID().replaceAll('-','')}`;
function sql(input,db=database){const r=spawnSync('docker',['exec','-i','-e','PGPASSWORD=','-e','PGOPTIONS=','-e','PGPASSFILE=/tmp/budget-no-pgpass',container,'psql','-XqAt','--no-password','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;}
const folder=new URL('../migrations/',import.meta.url);
try {
 const version=Number(sql("select current_setting('server_version_num');",'postgres').trim());assert.ok(version>=170000&&version<180000);
 sql(`create database ${database};`,'postgres');
 console.log(`Disposable rehearsal database: ${database}`);
 sql(`create schema auth;create schema extensions;
 create table auth.users(id uuid primary key,instance_id uuid,aud text,role text,email text);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 grant usage on schema auth,public,extensions to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to authenticated,service_role;
 alter default privileges in schema public grant all on sequences to authenticated,service_role;`);
 for(const file of readdirSync(folder).filter(f=>f.endsWith('.sql')&&f<'20261123000000').sort()) sql(readFileSync(new URL(file,folder),'utf8'));
 sql(`insert into auth.users(id,email) values('ce000000-0000-4000-8000-000000000001','rehearsal@example.test'),('ce000000-0000-4000-8000-000000000002','rehearsal-b@example.test');
 select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',false);set role authenticated;
 insert into public.wallets(id,name,kind,currency,opening_balance_minor,position) values
 ('ce100000-0000-4000-8000-000000000001','Legacy USD','cash','USD',12345,9),
 ('ce100000-0000-4000-8000-000000000002','Legacy LBP','cash','LBP',90000,2),
 ('ce100000-0000-4000-8000-000000000003','Archived zero','cash','USD',0,3),
 ('ce100000-0000-4000-8000-000000000004','Archived debt','card','USD',-25,4),
 ('ce100000-0000-4000-8000-000000000005','Archived salary','bank','USD',0,5),
 ('ce100000-0000-4000-8000-000000000006','Legacy SYP','cash','SYP',17,6),
 ('ce100000-0000-4000-8000-000000000007','Archived paid loan','cash','USD',0,7);
 select public.create_loan(jsonb_build_object('requestId','ce400000-0000-4000-8000-000000000001','name','Paid historical loan','direction','borrowed','walletId','ce100000-0000-4000-8000-000000000007','feeCategoryId',(select id from public.categories where kind='expense' and parent_id is null limit 1),'principalMinor',100,'feeBps',0,'creationMode','existing','openedOn','2026-01-01','principalPaidBeforeMinor',100,'feePaidBeforeMinor',0));
 update public.profiles set salary_wallet_id='ce100000-0000-4000-8000-000000000005',salary_amount_minor=100 where user_id=auth.uid();
 select public.record_transfer('2026-11-05','ce100000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000002',10,9000);
 select public.save_transaction('ce200000-0000-4000-8000-000000000001',null,jsonb_build_object('kind','expense','occurredOn','2026-11-05','walletId','ce100000-0000-4000-8000-000000000001','amountMinor',100,'categoryId',(select id from public.categories where kind='expense' and parent_id is null limit 1)),null,'{"tenderMinor":200,"changes":[{"walletId":"ce100000-0000-4000-8000-000000000002","amountMinor":300}]}');
 select public.create_pending_payment('{"requestId":"ce300000-0000-4000-8000-000000000001","client":"Fixture","project":"Migration","currency":"USD","totalMinor":500,"dueOn":null}');
 select public.record_pending_receipt(jsonb_build_object('requestId','ce200000-0000-4000-8000-000000000002','paymentId','ce300000-0000-4000-8000-000000000001','walletId','ce100000-0000-4000-8000-000000000001','categoryId',(select id from public.categories where kind='income' and parent_id is null limit 1),'amountMinor',10,'occurredOn','2026-11-05'));
 update public.transactions set deleted_at=now() where id='ce200000-0000-4000-8000-000000000001';
 update public.wallets set archived_at=now() where id in('ce100000-0000-4000-8000-000000000003','ce100000-0000-4000-8000-000000000004','ce100000-0000-4000-8000-000000000005','ce100000-0000-4000-8000-000000000007');
 reset role; create schema fixture_private;
 create table fixture_private.totals as select wallet_id id,balance_minor from public.wallet_balances;
 create table fixture_private.money as select id,amount_minor,to_amount_minor,tender_minor,revision,deleted_at from public.transactions;
 create table fixture_private.change as select id,amount_minor,currency::text currency from public.cashier_changes;`);
 sql(readFileSync(new URL('20261123000000_custom_currencies_multi_wallets.sql',folder),'utf8'));
 const result=sql(`create extension if not exists pgtap with schema extensions;set search_path=public,extensions;begin;select no_plan();
 select is((select count(*) from public.currencies),6::bigint,'both existing users receive exact defaults');
 select is((select count(*) from public.wallet_balances),7::bigint,'one balance per legacy wallet');
 select is((select count(*) from public.wallet_balances b join public.wallets w on b.id=w.id where b.wallet_id=w.id and w.default_balance_id=b.id),7::bigint,'container IDs and exact default references survive');
 select is((select count(*) from fixture_private.totals e full join public.wallet_balance_totals b on b.balance_id=e.id where e.balance_minor is distinct from b.balance_minor),0::bigint,'all opening/current amounts preserved');
 select is((select count(*) from fixture_private.money e full join public.transactions t using(id) where row(e.amount_minor,e.to_amount_minor,e.tender_minor,e.revision,e.deleted_at) is distinct from row(t.amount_minor,t.to_amount_minor,t.tender_minor,t.revision,t.deleted_at)),0::bigint,'transaction amounts, revisions and deleted states preserved');
 select is((select count(*) from fixture_private.change e full join public.cashier_changes c using(id) where row(e.amount_minor,e.currency) is distinct from row(c.amount_minor,c.currency)),0::bigint,'historical change facts preserved');
 select ok((select deleted_at is not null and not needs_attention from public.wallets where id='ce100000-0000-4000-8000-000000000003'),'archived zero becomes tombstone');
 select ok((select deleted_at is not null and not needs_attention from public.wallets where id='ce100000-0000-4000-8000-000000000007'),'fully paid historical loan does not block zero-wallet tombstoning');
 select is((select count(*) from public.wallets where needs_attention and deleted_at is null),2::bigint,'archived debt and salary dependency remain hidden Needs attention');
 select is((select array_agg(name order by position) from public.wallets where deleted_at is null and not needs_attention),array['Legacy LBP','Legacy SYP','Legacy USD'],'existing relative order preserved and compacted');
 select is((select array_agg(position order by position) from public.wallets where deleted_at is null and not needs_attention),array[0,1,2],'active ordering dense');
 select ok((select pending_receipt_payload ? 'balanceId' and not(pending_receipt_payload ? 'walletId') from public.transactions where id='ce200000-0000-4000-8000-000000000002'),'receipt replay carries exact balance key');
 select is((select count(*) from public.transactions where wallet_name_snapshot='Legacy USD'),3::bigint,'all transaction source snapshots backfilled');
 select is((select balance_id from public.cashier_changes limit 1),'ce100000-0000-4000-8000-000000000002'::uuid,'soft-deleted change balance backfilled');
 select ok(not exists(select 1 from pg_type where typnamespace='public'::regnamespace and typname='currency'),'enum removed without CASCADE');
 select * from finish();rollback;`);
 console.log(result);assert.doesNotMatch(result,/(?:^|\n)not ok |Looks like you failed/);console.log('PASS populated migration preservation: 15 assertions.');
 // Populate the committed per-wallet schema with sparse, detached and disabled
 // catalog states before applying the global revision.
 sql(`select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',false);set role authenticated;
 insert into public.currencies(code,symbol,decimal_places) values('BACKFILL','B',4),('DORMANT','D',0);
 select public.add_wallet_balance('ce100000-0000-4000-8000-000000000001','LBP');
 select public.detach_wallet_balance((select id from public.wallet_balances where wallet_id='ce100000-0000-4000-8000-000000000001' and currency='LBP'));
 select public.set_currency_disabled('DORMANT',true);
 reset role;
 create table fixture_private.pre_global_balances as select * from public.wallet_balances;
 create table fixture_private.pre_global_wallets as select * from public.wallets;
 create table fixture_private.pre_global_transactions as select * from public.transactions;
 create table fixture_private.pre_global_changes as select * from public.cashier_changes;`);
 sql(readFileSync(new URL('20261124000000_global_currencies_all_wallets.sql',folder),'utf8'));
 const globalResult=sql(`set search_path=public,extensions;begin;select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);select no_plan();
 select is((select count(*) from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.deleted_at is null),20::bigint,'all five live and Needs-attention wallets get four enabled balances');
 select is((select count(*) from fixture_private.pre_global_balances old left join public.wallet_balances b using(id) where b.id is null or (old.user_id,old.wallet_id,old.currency,old.opening_balance_minor,old.created_at) is distinct from (b.user_id,b.wallet_id,b.currency,b.opening_balance_minor,b.created_at)),0::bigint,'existing balance IDs, amounts and metadata preserved');
 select is((select count(*) from fixture_private.pre_global_wallets old join public.wallets w using(id) where to_jsonb(old) is distinct from to_jsonb(w)),0::bigint,'all wallet defaults, order, Needs-attention and tombstones unchanged');
 select is((select count(*) from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.deleted_at is not null),2::bigint,'tombstones receive no migration additions');
 select is((select count(*) from public.wallet_balances b join public.currencies c on(c.user_id,c.code)=(b.user_id,b.currency) join public.wallets w on w.id=b.wallet_id where w.deleted_at is null and c.disabled_at is null and b.detached_at is not null),0::bigint,'enabled detach state normalized without replacing IDs');
 select results_eq($$select b.currency,b.position from public.wallet_balances b where wallet_id='ce100000-0000-4000-8000-000000000004' order by b.position$$,$$values ('LBP'::text,0),('SYP',1),('USD',2),('BACKFILL',3)$$,'Needs-attention balances use catalog addition order');
 select is((select count(*) from fixture_private.pre_global_transactions old full join public.transactions t using(id) where to_jsonb(old) is distinct from to_jsonb(t)),0::bigint,'all historical transactions and snapshots byte-for-byte preserved');
 select is((select count(*) from fixture_private.pre_global_changes old full join public.cashier_changes c using(id) where to_jsonb(old) is distinct from to_jsonb(c)),0::bigint,'all cashier history and snapshots preserved');
 select is((select count(*) from fixture_private.totals old join public.wallet_balance_totals b on b.balance_id=old.id where old.balance_minor is distinct from b.balance_minor),0::bigint,'all old exact totals unchanged');
 select is((select count(*) from public.wallet_balance_totals b where not exists(select 1 from fixture_private.pre_global_balances old where old.id=b.balance_id) and b.balance_minor<>0),0::bigint,'all new balances are exact zero');
 select ok((select first_used_at is null from public.currencies where code='BACKFILL'),'backfilled zero rows do not mark unused catalog used');
 set role authenticated;
 select lives_ok($$select public.create_currency('AFTER','A',0)$$,'global add also reaches Needs-attention wallets');
 select is((select count(*) from public.wallet_balances where currency='AFTER'),5::bigint,'global add reaches exactly five nondeleted wallets');
 select lives_ok($$select public.set_currency_disabled('DORMANT',false)$$,'re-enable repairs exceptional missing rows');
 select is((select count(*) from public.wallet_balances where currency='DORMANT'),5::bigint,'re-enable fills every nondeleted wallet');
 select is((select count(*) from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.deleted_at is not null),2::bigint,'later add and enable leave tombstones unchanged');
 set constraints all immediate;
 select * from finish();rollback;`);
 console.log(globalResult);assert.doesNotMatch(globalResult,/(?:^|\n)not ok |Looks like you failed/);console.log('PASS populated global migration preservation: 16 assertions.');
 sql("delete from auth.users where id in('ce000000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000002');");
 let assertions=0;
 for(const file of readdirSync(new URL('./',import.meta.url)).filter(f=>f.endsWith('.test.sql')).sort()) {
  const output=sql('set search_path=public,extensions;'+readFileSync(new URL(file,import.meta.url),'utf8'));
  assert.doesNotMatch(output,/(?:^|\n)not ok |Looks like you failed/,file);
  const count=Number(output.match(/(?:^|\n)1\.\.(\d+)/)?.[1]); assert.ok(count>0,file);
  assertions+=count;console.log(`PASS fresh migration ${file}: ${count} assertions`);
 }
 console.log(`PASS full fresh-migration pgTAP suite: ${assertions} assertions.`);
} catch(error){console.error(error.message);process.exitCode=1;}
// The controller owns cleanup, including this explicitly printed disposable DB.
