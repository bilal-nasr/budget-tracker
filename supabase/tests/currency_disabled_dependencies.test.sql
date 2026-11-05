-- Rollback-only regression coverage for reactivating resolved dependencies after
-- global currency disable. Each bypass uses a separate currency/fixture.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values
 ('cdb00000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','disabled-dependencies@example.test');
select set_config('request.jwt.claims','{"sub":"cdb00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
create temp table dependency_categories as
 select id,row_number() over(order by position,id) n from public.categories
 where kind='expense' and parent_id is null;
select public.create_currency(code,symbol,2) from (values('INST','I'),('BDATE','D'),('BCAT','C'),('BDEL','X')) c(code,symbol);
create temp table dependency_wallet as select public.create_wallet('Resolved installment','cash','INST',0) id;
insert into public.installments(id,name,total_minor,paid_before_minor,currency,balance_id,category_id)
 select 'cdb10000-0000-4000-8000-000000000001','Completed before tracking',100,100,'INST',
 w.default_balance_id,c.id from public.wallets w cross join dependency_categories c
 where w.id=(select id from dependency_wallet) and c.n=1;
select lives_ok($$select public.set_currency_disabled('INST',true)$$,
 'completed installment does not prevent disabling its zero-balance currency');
select throws_ok($$update public.installments set paid_before_minor=0
 where id='cdb10000-0000-4000-8000-000000000001'$$,'P0001','currency.disabled',
 'lowering paid-before cannot reopen an installment in a disabled currency');
select is((select remaining_minor from public.installment_progress
 where installment_id='cdb10000-0000-4000-8000-000000000001'),0::numeric,
 'rejected paid-before mutation leaves the installment completed');
select lives_ok($$update public.installments set name='Corrected historical title'
 where id='cdb10000-0000-4000-8000-000000000001'$$,
 'disabled-currency installment still permits a descriptive correction');

insert into public.budgets(category_id,currency,starts_month,limit_minor)
 select c.id,d.code,d.starts_month::date,d.limit_minor::bigint
 from dependency_categories c cross join(values
 ('BDATE','2026-01-01',100),('BDATE','2026-02-01',null),
 ('BCAT','2026-01-01',100),('BCAT','2026-02-01',null),
 ('BDEL','2026-01-01',100),('BDEL','2026-02-01',null)) d(code,starts_month,limit_minor)
 where c.n=1;
select lives_ok($$select public.set_currency_disabled('BDATE',true)$$,
 'superseded budget permits disabling BDATE');
select lives_ok($$select public.set_currency_disabled('BCAT',true)$$,
 'superseded budget permits disabling BCAT');
select lives_ok($$select public.set_currency_disabled('BDEL',true)$$,
 'superseded budget permits disabling BDEL');

select throws_ok($$update public.budgets set starts_month='2099-01-01'
 where currency='BDATE' and limit_minor=100$$,'P0001','currency.disabled',
 'moving a superseded budget into the future cannot reactivate a disabled currency');
select is((select starts_month from public.budgets where currency='BDATE' and limit_minor=100),
 '2026-01-01'::date,'rejected budget-date mutation preserves the historical start');
select throws_ok($$update public.budgets set category_id=(select id from dependency_categories where n=2)
 where currency='BCAT' and limit_minor=100$$,'P0001','currency.disabled',
 'changing a superseded budget category cannot reactivate a disabled currency');
select is((select count(*) from public.month_budgets(current_date) where currency='BCAT'),0::bigint,
 'rejected category mutation leaves no active disabled-currency budget');
select throws_ok($$delete from public.budgets where currency='BDEL' and limit_minor is null$$,
 'P0001','currency.disabled','deleting cancellation cannot reveal an older disabled-currency budget');
select is((select count(*) from public.budgets where currency='BDEL'),2::bigint,
 'rejected cancellation deletion preserves both historical versions');

select lives_ok($$update public.budgets set created_at=created_at-interval '1 second'
 where currency='BDATE'$$,'historical metadata correction remains allowed after disable');
select lives_ok($$delete from public.budgets where currency='BDEL' and limit_minor=100$$,
 'deleting a superseded historical limit is harmless and remains allowed');
select is((select count(*) from public.month_budgets(current_date) where currency='BDEL'),0::bigint,
 'harmless historical deletion does not recreate an active budget');
select lives_ok($$delete from public.budgets where currency='BDEL' and limit_minor is null$$,
 'a cancellation can be deleted when no older limit can reappear');
select is((select count(*) from public.budgets where currency='BDEL'),0::bigint,
 'harmless deletion removes the remaining cancellation');
reset role;
set constraints all immediate;
select * from finish();
rollback;
