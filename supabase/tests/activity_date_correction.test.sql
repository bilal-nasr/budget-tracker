-- Date-only corrections for loans, loan payments and transfers. Synthetic fixtures only; run with pnpm db:test.
begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
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
create function pg_temp.disbursement_id() returns uuid language sql as $$
  select id from public.transactions where loan_event='disbursement' and loan_id=(select id from public.loans where name='Synthetic loan 1')
$$;
create function pg_temp.rev(p_id uuid) returns integer language sql as $$ select revision from public.transactions where id=p_id $$;

select lives_ok($$select public.create_loan(pg_temp.loan_args(1)||jsonb_build_object('openedOn',public.loan_today()-10))$$,'loan opened ten days ago');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(1,1,40000)||jsonb_build_object('occurredOn',public.loan_today()-6))$$,'first payment');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(1,2,20000)||jsonb_build_object('occurredOn',public.loan_today()-2))$$,'second payment');
set constraints all immediate;
set constraints all deferred;

select lives_ok($$select * from public.set_transaction_date(pg_temp.payment_id(1),pg_temp.payment_revision(1),public.loan_today()-5)$$,'a payment may move between its neighbours');
select is((select occurred_on from public.transactions where id=pg_temp.payment_id(1)),public.loan_today()-5,'payment date saved');
select throws_ok($$select * from public.set_transaction_date(pg_temp.payment_id(2),pg_temp.payment_revision(2),public.loan_today()-8)$$,null,'loan.paymentOrder','a later payment cannot move before an earlier one');
select throws_ok($$select * from public.set_transaction_date(pg_temp.payment_id(1),pg_temp.payment_revision(1),public.loan_today()-1)$$,null,'loan.paymentOrder','an earlier payment cannot move after a later one');
select throws_ok($$select * from public.set_transaction_date(pg_temp.payment_id(1),pg_temp.payment_revision(1),public.loan_today()-11)$$,null,'loan.invalid','a payment cannot predate the loan');
select throws_ok($$select * from public.set_transaction_date(pg_temp.payment_id(1),pg_temp.payment_revision(1),public.loan_today()+1)$$,null,'loan.invalid','a payment cannot be in the future');
select throws_ok($$select * from public.set_transaction_date(pg_temp.payment_id(1),pg_temp.payment_revision(1)-1,public.loan_today()-4)$$,null,'loan.conflict','a stale revision is rejected');
select throws_ok($$update public.transactions set amount_minor=1 where id=pg_temp.payment_id(1)$$,null,'loan.managedTransaction','amounts stay locked');

select lives_ok($$select * from public.set_transaction_date(pg_temp.disbursement_id(),pg_temp.rev(pg_temp.disbursement_id()),public.loan_today()-9)$$,'the disbursement moves the loan opening day');
set constraints all immediate;
set constraints all deferred;
select is((select opened_on from public.loans where name='Synthetic loan 1'),public.loan_today()-9,'loan opening day follows its disbursement');
select throws_ok($$select * from public.set_transaction_date(pg_temp.disbursement_id(),pg_temp.rev(pg_temp.disbursement_id()),public.loan_today()-3)$$,null,'loan.termsLocked','the opening day cannot pass a recorded payment');
update public.loans set opened_on=public.loan_today()-7 where name='Synthetic loan 1';
select throws_ok($$set constraints all immediate$$,null,'loan.invalid','an opening day that disagrees with its disbursement is refused at commit');
update public.loans set opened_on=public.loan_today()-9 where name='Synthetic loan 1';
set constraints all immediate;
set constraints all deferred;

select lives_ok($$select public.record_balance_transfer('ca400000-0000-4000-8000-000000000001',public.loan_today()-1,'ca100000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000003',500,500)$$,'a transfer is recorded');
select lives_ok($$select * from public.set_transaction_date((select id from public.transactions where kind::text='transfer' limit 1),(select revision from public.transactions where kind::text='transfer' limit 1),public.loan_today()-4)$$,'a transfer date can be corrected');
select is((select occurred_on from public.transactions where kind::text='transfer' limit 1),public.loan_today()-4,'transfer date saved');
select * from finish();
rollback;
