-- Disposable local database only. Run with supabase test db after all prior round-3 migrations.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email) values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cycle-a@example.test'),
  ('a5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cycle-b@example.test');
select set_config('request.jwt.claims', '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
with fixture(id,name,kind,currency) as (values ('a5100000-0000-4000-8000-000000000001', 'Cycle bank', 'bank', 'USD'),
  ('a5100000-0000-4000-8000-000000000002', 'Cycle cash', 'cash', 'LBP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select c.id,c.user_id,c.id,f.currency,0::bigint,0 from fixture f join containers c on c.id=f.id::uuid;
insert into public.installments (id, name, total_minor, monthly_minor, balance_id, category_id)
select 'a5200000-0000-4000-8000-000000000001', 'Cycle laptop', 100000, 10000,
  'a5100000-0000-4000-8000-000000000001', c.id
from public.categories c where c.kind = 'expense' and c.parent_id is null order by c.position limit 1;
update public.profiles set salary_amount_minor = 180000, salary_balance_id = 'a5100000-0000-4000-8000-000000000001';
-- Name edits must not redirect future salary receipts to another root.
update public.categories set name_en='Renamed income root'
where id=(select id from public.categories where kind='income' and parent_id is null order by position,id limit 1);
insert into public.categories(kind,name_en,tile,color,position) values ('income','Salary',7,'teal',9999);

create function pg_temp.cycle_pay(n integer, amount bigint, cycle uuid default null, extra uuid default null)
returns jsonb language sql as $f$
  select to_jsonb(r) from public.record_installment_payment(
    ('a5300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
    'a5200000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001',
    amount, current_date - 60, cycle, extra
  ) r
$f$;
create function pg_temp.cycle_salary(n integer, expected uuid default null)
returns jsonb language sql as $f$
  select to_jsonb(r) from public.receive_salary(
    ('a5400000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, expected
  ) r
$f$;

select is(public.installment_cycle_snapshot()->'receipt', 'null'::jsonb, 'before first salary has a null receipt');
select is(pg_temp.cycle_pay(1,4000)->>'revision', '1', 'first partial payment returns canonical revision');
select is((select salary_cycle_id from public.transactions where id='a5300000-0000-4000-8000-000000000001'), null::uuid, 'initial payment belongs to null cycle');
select throws_ok($$select pg_temp.cycle_pay(2,6000)$$, 'P0001', 'already paid this cycle', 'another normal payment is refused even for a partial');
select lives_ok($$select pg_temp.cycle_pay(2,6000,null,'a5300000-0000-4000-8000-000000000001')$$, 'acknowledged top-up succeeds');
select throws_ok($$select pg_temp.cycle_pay(3,100,null,'a5300000-0000-4000-8000-000000000001')$$, 'P0001', 'installment payment changed', 'stale override cannot authorize a second extra payment');
select is((select remaining_minor from public.installment_progress where installment_id='a5200000-0000-4000-8000-000000000001'), 90000::numeric, 'partial plus top-up reduce principal once');
select is((public.installment_cycle_snapshot()->'payments'->0->>'id'), 'a5300000-0000-4000-8000-000000000002', 'snapshot payments use recording order');

select is(pg_temp.cycle_salary(1)->>'revision','1','salary RPC returns a canonical revision');
select is((select category_id from public.transactions where id='a5400000-0000-4000-8000-000000000001'),
  (select id from public.categories where kind='income' and parent_id is null and archived_at is null order by position,id limit 1),
  'salary fallback respects active root order after a rename rather than matching category text');
select is(pg_temp.cycle_salary(1)->>'id','a5400000-0000-4000-8000-000000000001','same salary request replays without another receipt');
select is((select count(*) from public.transactions where source='salary'),1::bigint,'salary retry creates one income');
select is((select remaining_minor from public.installment_progress where installment_id='a5200000-0000-4000-8000-000000000001'),90000::numeric,'salary does not reset principal');
select throws_ok($$select pg_temp.cycle_pay(3,10000)$$,'P0001','salary cycle changed','form from before salary cannot silently pay a new cycle');
select lives_ok($$select pg_temp.cycle_pay(3,10000,'a5400000-0000-4000-8000-000000000001')$$,'backdated accounting date is allowed in current receipt cycle');
select is((select salary_cycle_id from public.transactions where id='a5300000-0000-4000-8000-000000000003'),'a5400000-0000-4000-8000-000000000001'::uuid,'backdating does not choose an older cycle');
select is(pg_temp.cycle_pay(3,10000,'a5400000-0000-4000-8000-000000000001')->>'id','a5300000-0000-4000-8000-000000000003','same payment UUID replays before repeat check');
select throws_ok($$select pg_temp.cycle_pay(3,9999,'a5400000-0000-4000-8000-000000000001')$$,'P0001','transaction request already used','different intent cannot reuse a payment UUID');

-- Direct authenticated DML must obey the same normal/extra rules as RPCs.
select throws_ok($$
  insert into public.transactions(kind,occurred_on,balance_id,amount_minor,currency,category_id,source,installment_id,salary_cycle_id)
  select 'expense',current_date,i.balance_id,100,'USD',i.category_id,'installment',i.id,'a5400000-0000-4000-8000-000000000001'
  from public.installments i where i.id='a5200000-0000-4000-8000-000000000001'
$$,'P0001','already paid this cycle','direct insert cannot bypass acknowledgment');
select throws_ok($$update public.transactions set salary_cycle_id=null where id='a5300000-0000-4000-8000-000000000003'$$,'P0001','installment identity cannot change','cycle metadata cannot be edited');
select throws_ok($$update public.transactions set installment_id=null where id='a5300000-0000-4000-8000-000000000003'$$,'P0001','installment identity cannot change','a live debt payment cannot be unlinked');
select throws_ok($$update public.transactions set kind='expense' where id='a5400000-0000-4000-8000-000000000001'$$,'P0001','salary receipts must be income','editing a tagged salary to expense is refused');

-- Keep the shared revision-aware lifecycle API; never add an unchecked restore.
select is((select revision from public.set_transaction_deleted('a5300000-0000-4000-8000-000000000003',1,true)),2,'delete returns new revision');
select throws_ok($$select * from public.set_transaction_deleted('a5300000-0000-4000-8000-000000000003',1,true)$$,null,'transaction conflict','expected+1 same-state delete is still a stale revision');
select throws_ok($$select pg_temp.cycle_pay(3,10000,'a5400000-0000-4000-8000-000000000001')$$,'P0001','transaction request already used','retry never resurrects a deleted payment');
select lives_ok($$select pg_temp.cycle_pay(4,7000,'a5400000-0000-4000-8000-000000000001')$$,'deleting last current-cycle payment releases normal Pay');
select lives_ok($$select * from public.set_transaction_deleted('a5300000-0000-4000-8000-000000000003',2,false)$$,'historical restore may coexist with a later payment when principal fits');
select lives_ok($$
  select * from public.save_transaction('a5300000-0000-4000-8000-000000000004',1,
    jsonb_build_object('kind','expense','occurredOn',(current_date-60)::text,
      'balanceId','a5100000-0000-4000-8000-000000000001','amountMinor',7000,
      'categoryId',(select category_id from public.installments where id='a5200000-0000-4000-8000-000000000001'),
      'note','Cycle laptop revised'),null,null)
$$,'five-argument canonical save preserves source and cycle while editing');
select is((select salary_cycle_id from public.transactions where id='a5300000-0000-4000-8000-000000000004'),
  'a5400000-0000-4000-8000-000000000001'::uuid,'canonical editor preserves immutable cycle association');
select lives_ok($$
  select * from public.save_transaction('a5300000-0000-4000-8000-000000000004',
    (select revision from public.transactions where id='a5300000-0000-4000-8000-000000000004'),
    jsonb_build_object('kind','expense','occurredOn',(current_date-60)::text,
      'balanceId','a5100000-0000-4000-8000-000000000001','amountMinor',7000,
      'categoryId',(select category_id from public.installments where id='a5200000-0000-4000-8000-000000000001'),
      'note','Cycle laptop itemized'),
    '[{"description":"First part","amountMinor":1500},{"description":"Second part","amountMinor":2000}]'::jsonb,null)
$$,'linked payment can gain a breakdown through the canonical editor');
select is(public.installment_cycle_snapshot()->'payments'->0->>'note','Cycle laptop itemized','cycle history retains the actual edited parent name');
select is((public.installment_cycle_snapshot()->'payments'->0->>'revision')::integer,
  (select revision from public.transactions where id='a5300000-0000-4000-8000-000000000004'),
  'cycle history carries actual revision after item touches');
select is(jsonb_array_length(public.installment_cycle_snapshot()->'payments'->0->'expense_items'),2,
  'cycle history contains every saved expense item');
select is(public.installment_cycle_snapshot()->'payments'->0->'expense_items'->0->>'description','First part',
  'snapshot item order matches the canonical detail/editor order');
select ok((public.installment_cycle_snapshot()->'payments'->0) ?& array['currency','category_id','kind','source','tender_minor','change_balance_id','change_minor'],
  'snapshot retains the complete parent including cashier metadata fields');
select is((select remaining_minor from public.installment_progress where installment_id='a5200000-0000-4000-8000-000000000001'),73000::numeric,'restoration preserves both real expenses and principal');
select throws_ok($$select pg_temp.cycle_pay(5,73001,'a5400000-0000-4000-8000-000000000001','a5300000-0000-4000-8000-000000000004')$$,'P0001','exceeds remaining','explicit override cannot exceed principal');

select lives_ok($$select * from public.set_transaction_deleted('a5400000-0000-4000-8000-000000000001',1,true)$$,'salary can be undone through shared lifecycle');
select is(public.installment_cycle_snapshot()->'receipt','null'::jsonb,'salary deletion returns to initial bucket');
select is((select count(*) from public.transactions where source='installment' and deleted_at is null),4::bigint,'salary undo preserves all installment expenses');
select is((select count(*) from public.transactions where salary_cycle_id='a5400000-0000-4000-8000-000000000001'),2::bigint,'salary undo never reassigns associated payments');
select lives_ok($$select * from public.set_transaction_deleted('a5400000-0000-4000-8000-000000000001',2,false)$$,'restored salary retains identity');
select lives_ok($$select pg_temp.cycle_salary(2,'a5400000-0000-4000-8000-000000000001')$$,'second actual receipt in same calendar day opens another cycle');
select throws_ok($$select pg_temp.cycle_salary(3,'a5400000-0000-4000-8000-000000000001')$$,'P0001','salary cycle changed','stale second salary confirmation is refused');
select is(public.installment_cycle_snapshot()->'receipt'->>'id','a5400000-0000-4000-8000-000000000002','latest actual receipt is selected by immutable recording order');

-- Unrelated income named Salary is not a boundary, and cycle metadata is not allowed on it.
insert into public.transactions(kind,occurred_on,balance_id,amount_minor,currency,category_id,note)
select 'income',current_date,'a5100000-0000-4000-8000-000000000001',1,'USD',c.id,'Salary'
from public.categories c where kind='income' and parent_id is null order by position limit 1;
select is(public.installment_cycle_snapshot()->'receipt'->>'id','a5400000-0000-4000-8000-000000000002','a note cannot create a cycle');
select throws_ok($$
  insert into public.transactions(kind,occurred_on,balance_id,amount_minor,currency,category_id,salary_cycle_id)
  select 'income',current_date,'a5100000-0000-4000-8000-000000000001',1,'USD',c.id,'a5400000-0000-4000-8000-000000000002'
  from public.categories c where kind='income' and parent_id is null order by position limit 1
$$,'P0001','invalid installment cycle','ordinary income cannot carry payment metadata');

select set_config('request.jwt.claims', '{"sub":"a5000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.installment_cycle_snapshot()->'installments','[]'::jsonb,'B sees no installment of A');
select is(public.installment_cycle_snapshot()->'payments','[]'::jsonb,'B sees no payments of A');
select is(public.installment_cycle_snapshot()->'receipt','null'::jsonb,'B sees no salary of A');
select throws_ok($$select pg_temp.cycle_pay(50,100)$$,'P0001','installment not found','B cannot pay A installment');
select throws_ok($$select pg_temp.cycle_salary(2)$$,null,null,'B cannot claim A request identity');
select set_config('request.jwt.claims', '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$select public.delete_installment('a5200000-0000-4000-8000-000000000001')$$,'template deletion retains payment history');
select is((select count(*) from public.transactions where source='installment' and installment_id is null),4::bigint,'all detached payments stay in ledger');
select is((select sum(amount_minor) from public.transactions where source='installment' and deleted_at is null),27000::numeric,'template deletion never removes expenses');

select * from finish();
rollback;
