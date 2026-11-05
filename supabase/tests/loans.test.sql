-- Rollback-only synthetic account coverage. Run via the parent's disposable stack.
begin;
-- Only historical migration-state setup uses this administrator-owned helper.
-- Monetary tests still execute through authenticated production entry points.
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
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values
('ca000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','loan-a@example.test'),
('cb000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','loan-b@example.test');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
with fixture(id,name,kind,currency) as (values ('ca100000-0000-4000-8000-000000000001','Loan test USD','cash','USD'),
('ca100000-0000-4000-8000-000000000002','Loan test LBP','cash','LBP'),
('ca100000-0000-4000-8000-000000000003','Second USD','bank','USD'),
('ca100000-0000-4000-8000-000000000004','Loan test SYP','cash','SYP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

create function pg_temp.loan_args(key_number integer,direction text default 'borrowed',mode text default 'new',principal bigint default 100000,bps integer default 725)
returns jsonb language sql as $$
  select jsonb_build_object('requestId',('ca200000-0000-4000-8000-'||lpad(key_number::text,12,'0'))::uuid,
    'name','Synthetic loan '||key_number,'direction',direction,'principalMinor',principal,'feeBps',bps,
    'balanceId','ca100000-0000-4000-8000-000000000001','feeCategoryId',
    (select id from public.categories where kind::text=case when direction='borrowed' then 'expense' else 'income' end and archived_at is null order by position limit 1),
    'openedOn',public.loan_today(),'creationMode',mode,'principalPaidBeforeMinor',0,'feePaidBeforeMinor',0)
$$;
create function pg_temp.payment_args(loan_key integer,payment_key integer,amount bigint,wallet uuid default 'ca100000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select jsonb_build_object('requestId',('ca300000-0000-4000-8000-'||lpad(payment_key::text,12,'0'))::uuid,
    'loanId',(select id from public.loans where request_id=('ca200000-0000-4000-8000-'||lpad(loan_key::text,12,'0'))::uuid),
    'balanceId',wallet,'amountMinor',amount,'occurredOn',public.loan_today())
$$;
create function pg_temp.payment_id(payment_key integer) returns uuid language sql as $$
  select id from public.transactions where loan_request_id=('ca300000-0000-4000-8000-'||lpad(payment_key::text,12,'0'))::uuid
$$;
create function pg_temp.payment_revision(payment_key integer) returns integer language sql as $$
  select revision from public.transactions where id=pg_temp.payment_id(payment_key)
$$;
select lives_ok($$select public.create_loan(pg_temp.loan_args(1))$$,'borrowed principal creates its required disbursement');
set constraints all immediate;
set constraints all deferred;
select is((select fee_minor from public.loans where name='Synthetic loan 1'),7250::bigint,'percentage fee exact');
select is((select total_due_minor from public.loans where name='Synthetic loan 1'),107250::bigint,'total includes fee once');
select is((select balance_minor from public.wallet_balance_totals where balance_id='ca100000-0000-4000-8000-000000000001'),100000::numeric,'borrowed disbursement credits wallet');
select is((select count(*) from public.reporting_entries),0::bigint,'disbursement is not income');
select lives_ok($$select public.create_loan(pg_temp.loan_args(1))$$,'identical create retry is idempotent');
select is((select count(*) from public.transactions where kind::text='loan'),1::bigint,'retry creates no duplicate disbursement');
select throws_ok($$select public.create_loan(pg_temp.loan_args(1)||'{"principalMinor":99999}'::jsonb)$$,null,'loan.invalid','changed retry rejected');

-- Shared category trigger must accept an expense fee category even when fee is 0.
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(1,1,40000))$$,'principal-only borrowed repayment accepts expense fee category');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(1,1,40000))$$,'still-live original payment replay remains idempotent');
select is(pg_temp.payment_revision(1),1,'identical live replay never advances its original revision');
select is((select loan_fee_minor from public.transactions where id=pg_temp.payment_id(1)),0::bigint,'first payment fee zero');
select is((select remaining_minor from public.loan_progress where name='Synthetic loan 1'),67250::bigint,'partial remainder exact');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(1,2,65000))$$,'payment crosses into fee');
select is((select loan_principal_minor from public.transactions where id=pg_temp.payment_id(2)),60000::bigint,'principal-first split stored');
select is((select loan_fee_minor from public.transactions where id=pg_temp.payment_id(2)),5000::bigint,'fee split stored');
select is((select sum(amount_minor) from public.reporting_entries where kind='expense'),5000::numeric,'only fee contributes spending');
select is((select sum(spent_minor) from public.month_category_spend(public.loan_today())),5000::numeric,'budget counts fee once');
select throws_ok($$select public.record_loan_payment(pg_temp.payment_args(1,3,2251))$$,null,'loan.exceedsRemaining','one-minor overpayment rejected');
select throws_ok($$select public.record_loan_payment(pg_temp.payment_args(1,3,1,'ca100000-0000-4000-8000-000000000002'))$$,null,'loan.invalid','wrong currency rejected');
select throws_ok($$select public.void_loan_payment(pg_temp.payment_id(1),pg_temp.payment_revision(1))$$,null,'loan.paymentOrder','earlier active repayment cannot be voided');
select throws_ok($$update public.transactions set amount_minor=1 where id=pg_temp.payment_id(2)$$,null,'loan.managedTransaction','direct financial edit rejected');
select throws_ok($$update public.transactions set kind='expense' where id=pg_temp.payment_id(2)$$,null,'loan.managedTransaction','cannot turn a loan payment into an ordinary expense');
select throws_ok($$select public.set_transaction_deleted(pg_temp.payment_id(2),pg_temp.payment_revision(2),true)$$,null,'loan.managedTransaction','generic lifecycle RPC rejects managed loan events');
create temp table stale_generation as select pg_temp.payment_revision(2) as revision;
select lives_ok($$select public.void_loan_payment(pg_temp.payment_id(2),pg_temp.payment_revision(2))$$,'latest void allowed');
select is((select count(*) from public.reporting_entries),0::bigint,'void removes fee reporting');
select throws_ok($$select public.record_loan_payment(pg_temp.payment_args(1,2,65000))$$,null,'loan.conflict','old create replay cannot acquire a voided payment revision');
select lives_ok($$select public.restore_loan_payment(pg_temp.payment_id(2),pg_temp.payment_revision(2))$$,'original allocation restores');
select throws_ok($$select public.record_loan_payment(pg_temp.payment_args(1,2,65000))$$,null,'loan.conflict','old create replay cannot acquire a newer restored generation for Undo');
select throws_ok($$select public.void_loan_payment(pg_temp.payment_id(2),(select revision from stale_generation))$$,null,'loan.conflict','stale Undo cannot void a payment after another tab voided and restored it');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(1,3,2250))$$,'exact final payment settles');
select is((select remaining_minor from public.loan_progress where name='Synthetic loan 1'),0::bigint,'settled remainder zero');
select is((select sum(amount_minor) from public.reporting_entries where kind='expense'),7250::numeric,'full fee reported once');
select throws_ok($$select public.cancel_loan((select id from public.loans where name='Synthetic loan 1'))$$,null,'loan.inUse','active repayments prevent cancellation');
select lives_ok($$select public.set_loan_archived((select id from public.loans where name='Synthetic loan 1'),true)$$,'settled loan can archive');
select lives_ok($$select public.void_loan_payment(pg_temp.payment_id(3),pg_temp.payment_revision(3))$$,'voiding final payment reopens archived loan');
select ok((select archived_at is null from public.loans where name='Synthetic loan 1'),'archive flag cleared after void');

-- Existing no-cash balances and opposite direction.
select lives_ok($$select public.create_loan(pg_temp.loan_args(2,'lent','existing')||'{"principalPaidBeforeMinor":40000,"feePaidBeforeMinor":100}'::jsonb)$$,'existing lent loan has explicit historical balances');
select is((select remaining_minor from public.loan_progress where name='Synthetic loan 2'),67150::bigint,'both opening components subtract');
select is((select count(*) from public.transactions where loan_id=(select id from public.loans where name='Synthetic loan 2')),0::bigint,'existing record creates no cash event');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(2,4,67150))$$,'lent repayment accepts income fee category');
select is((select sum(amount_minor) from public.reporting_entries where kind='income'),7150::numeric,'lent fee realized as income without principal');
select lives_ok($$select public.create_loan(pg_temp.loan_args(3,'lent','new',10000,0))$$,'new lent loan disburses principal outward');
select is((select loan_flow from public.transactions where loan_id=(select id from public.loans where name='Synthetic loan 3')),'out','lent principal leaves wallet');
select lives_ok($$select public.cancel_loan((select id from public.loans where name='Synthetic loan 3'))$$,'cancel reverses disbursement atomically');
set constraints all immediate;
set constraints all deferred;
select is((select count(*) from public.transactions where loan_id=(select id from public.loans where name='Synthetic loan 3') and deleted_at is null),0::bigint,'canceled disbursement no longer live');

-- Active templates protect their fee category, independently of history.
select throws_ok($$update public.categories set archived_at=now() where id=(select fee_category_id from public.loans where name='Synthetic loan 2')$$,null,'category_in_use','active-loan category cannot be archived');
select throws_ok($$select public.remove_category((select fee_category_id from public.loans where name='Synthetic loan 2'))$$,null,'category_in_use','active-loan category removal explains in-use');
select throws_ok($$delete from public.categories where id=(select fee_category_id from public.loans where name='Synthetic loan 2')$$,null,'category_in_use','direct delete of loan category rejected');
insert into public.categories(id,kind,name_en,tile,color) values('ca500000-0000-4000-8000-000000000007','expense','Cancelled loan history',1,'teal');
select lives_ok($$select public.create_loan(pg_temp.loan_args(7,'borrowed','existing',100,0)||'{"feeCategoryId":"ca500000-0000-4000-8000-000000000007"}'::jsonb)$$,'record-only loan can use a dedicated category');
select lives_ok($$select public.cancel_loan((select id from public.loans where name='Synthetic loan 7'))$$,'record-only loan can be cancelled without cash history');
select is(public.remove_category('ca500000-0000-4000-8000-000000000007'),'archived','cancelled-loan-only category archives instead of becoming permanently in-use');
create temp table historical_category as select fee_category_id as id from public.loans where name='Synthetic loan 2';
select lives_ok($$select public.update_loan((select id from public.loans where name='Synthetic loan 2'),jsonb_build_object('name','Synthetic loan 2','balanceId','ca100000-0000-4000-8000-000000000001','feeCategoryId',(select id from public.categories where kind='income' and archived_at is null and id<>(select id from historical_category) order by position limit 1)))$$,'fee category can explicitly reassign without changing historical payments');
update public.categories set archived_at=now() where id=(select id from historical_category);
select lives_ok($$select public.void_loan_payment(pg_temp.payment_id(4),pg_temp.payment_revision(4))$$,'void allows unchanged historical archived income category');
select lives_ok($$select public.restore_loan_payment(pg_temp.payment_id(4),pg_temp.payment_revision(4))$$,'restore allows unchanged historical archived income category');

select throws_ok($$update public.loans set fee_bps=1 where name='Synthetic loan 1'$$,null,'loan.termsLocked','financial terms immutable');
select throws_ok($$update public.wallet_balances set currency='LBP' where id='ca100000-0000-4000-8000-000000000001'$$,null,null,'referenced wallet currency locked');

-- A reference existing solely on loans still prevents reinterpretation/deletion.
select lives_ok($$select public.create_loan(pg_temp.loan_args(4,'borrowed','existing',5,1000)||'{"balanceId":"ca100000-0000-4000-8000-000000000003"}'::jsonb)$$,'record-only loan references second wallet');
select is((select fee_minor from public.loans where name='Synthetic loan 4'),1::bigint,'half-up tie rounds to smallest unit');
select throws_ok($$select public.create_loan(pg_temp.loan_args(5)||'{"principalMinor":"100"}'::jsonb)$$,null,'loan.invalid','RPC rejects string money instead of trusting client validation');
select throws_ok($$select public.create_loan(pg_temp.loan_args(5)||'{"feeBps":0.5}'::jsonb)$$,null,'loan.invalid','RPC rejects fractional basis points');
select throws_ok($$select public.create_loan(pg_temp.loan_args(5)||'{"userId":"forged"}'::jsonb)$$,null,'loan.invalid','RPC rejects extra ownership fields');
select throws_ok($$update public.wallet_balances set currency='LBP' where id='ca100000-0000-4000-8000-000000000003'$$,'P0001','balance.immutable','record-only balance currency locked');

-- A salary wallet can have no cash history but still belong to an existing loan.
-- The atomic deletion path rejects it before changing either salary field.
update public.profiles set salary_amount_minor=12345,salary_balance_id='ca100000-0000-4000-8000-000000000003' where user_id=auth.uid();
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000003')$$,null,'wallet.inUse','existing-loan-only salary wallet cannot be deleted');
select is((select salary_balance_id from public.profiles where user_id=auth.uid()),'ca100000-0000-4000-8000-000000000003'::uuid,'failed wallet delete preserves salary wallet');
select is((select salary_amount_minor from public.profiles where user_id=auth.uid()),12345::bigint,'failed wallet delete preserves salary amount');
select ok(exists(select 1 from public.wallets where id='ca100000-0000-4000-8000-000000000003'),'failed wallet delete retains wallet');
with fixture(id,name,kind,currency) as (values ('ca100000-0000-4000-8000-000000000005','Unused salary wallet','bank','USD')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
update public.profiles set salary_amount_minor=54321,salary_balance_id='ca100000-0000-4000-8000-000000000005' where user_id=auth.uid();
select throws_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000005')$$,null,'wallet.inUse','active salary wallet deletion rejected');
select is((select salary_amount_minor from public.profiles where user_id=auth.uid()),54321::bigint,'active-wallet rejection preserves salary');
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000005')$$,'P0001','wallet.inUse','salary must be resolved before wallet deletion');
update public.profiles set salary_amount_minor=null,salary_balance_id=null where user_id=auth.uid();
select lives_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000005')$$,'resolved zero wallet tombstones');
select ok((select salary_balance_id is null and salary_amount_minor is null from public.profiles where user_id=auth.uid()),'successful deletion clears salary fields together');
select is((select count(*) from public.wallets where id='ca100000-0000-4000-8000-000000000005' and deleted_at is not null),1::bigint,'successful deletion retains historical wallet');
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000003',false);

with fixture(id,name,kind,currency) as (values ('ca100000-0000-4000-8000-000000000006','Deleted expense source','cash','USD'),
('ca100000-0000-4000-8000-000000000007','Deleted change receiver','cash','USD'),
('ca100000-0000-4000-8000-000000000008','Deleted transfer receiver','bank','USD'),
('ca100000-0000-4000-8000-000000000009','Fixed-only wallet','bank','USD'),
('ca100000-0000-4000-8000-000000000010','Installment-only wallet','bank','USD')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
select public.save_transaction('ca200000-0000-4000-8000-000000000099',null,
  jsonb_build_object('kind','expense','occurredOn',public.loan_today(),'balanceId','ca100000-0000-4000-8000-000000000006',
    'amountMinor',500,'categoryId',fee_category_id),null,
  '{"tenderMinor":1000,"changes":[{"balanceId":"ca100000-0000-4000-8000-000000000007","amountMinor":500}]}'::jsonb)
from public.loans where name='Synthetic loan 1';
insert into public.transactions(kind,occurred_on,balance_id,amount_minor,currency,to_balance_id,to_amount_minor)
values('transfer',public.loan_today(),'ca100000-0000-4000-8000-000000000001',100,'USD','ca100000-0000-4000-8000-000000000008',100);
update public.transactions set deleted_at=now() where balance_id='ca100000-0000-4000-8000-000000000006' or to_balance_id='ca100000-0000-4000-8000-000000000008';
insert into public.fixed_expenses(name,amount_minor,balance_id,category_id)
select 'Synthetic fixed dependency',100,'ca100000-0000-4000-8000-000000000009',fee_category_id from public.loans where name='Synthetic loan 1';
insert into public.installments(name,total_minor,currency,balance_id,category_id)
select 'Synthetic installment dependency',100,'USD','ca100000-0000-4000-8000-000000000010',fee_category_id from public.loans where name='Synthetic loan 1';
update public.profiles set salary_amount_minor=777,salary_balance_id='ca100000-0000-4000-8000-000000000006' where user_id=auth.uid();
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000006',true);
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000007',true);
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000008',true);
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000009',true);
select pg_temp.seed_needs_attention('ca100000-0000-4000-8000-000000000010',true);
select throws_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000006')$$,null,'wallet.inUse','deleted source transaction still blocks deletion');
select is((select salary_amount_minor from public.profiles where user_id=auth.uid()),777::bigint,'history rejection also preserves salary');
select lives_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000007')$$,'zero historical balance permits tombstoning without deleting history');
select lives_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000008')$$,'zero historical balance permits tombstoning without deleting history');
select throws_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000009')$$,null,'wallet.inUse','fixed-only reference blocks deletion');
select throws_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000010')$$,null,'wallet.inUse','installment-only reference blocks deletion');

-- Invariant checks are explicitly flushed within caught subtransactions.
create function pg_temp.orphan_new_loan() returns void language plpgsql as $$
begin
  insert into public.loans(request_id,request_payload,name,direction,currency,balance_id,fee_category_id,principal_minor,fee_bps,fee_minor,total_due_minor,creation_mode,opened_on)
  select gen_random_uuid(),'{}','Orphan','borrowed','USD','ca100000-0000-4000-8000-000000000003',fee_category_id,100,0,0,100,'new',public.loan_today() from public.loans where name='Synthetic loan 4';
  set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.orphan_new_loan()$$,null,'loan.invalid','new loan without disbursement fails deferred invariant');
select throws_ok($$select public.create_loan(pg_temp.loan_args(5,'borrowed','existing',1000000000000000,1))$$,null,'loan.invalid','fee plus principal cap checked with wide numeric intermediate');
select lives_ok($$select public.create_loan(pg_temp.loan_args(6,'borrowed','new',1250,725)||'{"balanceId":"ca100000-0000-4000-8000-000000000004"}'::jsonb)$$,'SYP loan derives units from its wallet');
select is((select currency::text from public.loans where name='Synthetic loan 6'),'SYP','SYP currency retained');
select is((select fee_minor from public.loans where name='Synthetic loan 6'),91::bigint,'SYP fee rounds to whole pounds');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(6,6,1341,'ca100000-0000-4000-8000-000000000004'))$$,'SYP repayment stays in same currency');
select is((select sum(amount_minor) from public.reporting_entries where currency='SYP'),91::numeric,'SYP report contains only its fee');

create temp table foreign_loan as select id from public.loans where name='Synthetic loan 1';
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.loans),0::bigint,'B sees no loans');
select is((select count(*) from public.loan_progress),0::bigint,'B sees no balances');
select is((select count(*) from public.reporting_entries),0::bigint,'B sees no fee reporting');
select throws_ok($$select public.record_loan_payment(jsonb_build_object('requestId',gen_random_uuid(),'loanId',(select id from foreign_loan),'balanceId','ca100000-0000-4000-8000-000000000001','amountMinor',1,'occurredOn',public.loan_today()))$$,null,'loan.invalid','foreign loan cannot be paid');
select is(has_function_privilege('anon','public.create_loan(jsonb)','execute'),false,'anonymous create RPC denied');
select is(has_function_privilege('anon','public.delete_wallet(uuid)','execute'),false,'anonymous wallet deletion RPC denied');
select throws_ok($$select public.delete_wallet('ca100000-0000-4000-8000-000000000003')$$,null,'wallet.unavailable','foreign wallet deletion denied without leaking dependencies');
reset role;
select lives_ok($$delete from auth.users where id='ca000000-0000-4000-8000-000000000001'$$,'auth-account cleanup cascades without weakening normal category/history guards');
set constraints all immediate;
select * from finish();
rollback;
