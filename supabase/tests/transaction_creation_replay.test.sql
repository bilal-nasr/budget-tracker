-- A lost create reply must never adopt a later edit/restore generation.
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
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values
 ('e2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','creation-a@example.test'),
 ('e2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','creation-b@example.test');
select set_config('request.jwt.claims','{"sub":"e2000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
with fixture(id,name,kind,currency) as (values ('e2100000-0000-4000-8000-000000000001','Creation cash','cash','USD')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
create temp table creation_variants as
select 'plain-'||g as name,('e2200000-0000-4000-8000-'||lpad((1+n)::text,12,'0'))::uuid as id,
 jsonb_build_object('kind','expense','occurredOn','2026-11-04','balanceId','e2100000-0000-4000-8000-000000000001',
 'categoryId',(select id from public.categories where kind='expense' and parent_id is null order by position limit 1),
 'amountMinor',5000,'note','Creation fixture') as input,
 '[]'::jsonb as items,null::jsonb as settlement,null::integer as creation_revision
from (values ('restore',0),('edit',1)) v(g,n);
insert into creation_variants
select replace(name,'plain','items'),('e2200000-0000-4000-8000-'||lpad((3+row_number() over(order by name))::text,12,'0'))::uuid,
 input,'[{"description":"Phone credits","amountMinor":2000},{"description":"For sister","amountMinor":3000}]',null,null
from creation_variants where name like 'plain-%';
insert into creation_variants
select replace(name,'plain','settlement'),('e2200000-0000-4000-8000-'||lpad((6+row_number() over(order by name))::text,12,'0'))::uuid,
 input,'[{"description":"Phone credits","amountMinor":2000}]',
 '{"tenderMinor":6000,"changes":[{"balanceId":"e2100000-0000-4000-8000-000000000001","amountMinor":1000}]}',null
from creation_variants where name like 'plain-%';
create function pg_temp.creation_call(p_variant uuid) returns text language sql as $$
 select format('select * from public.save_transaction(%L,null,%L::jsonb,%L::jsonb,%L::jsonb)',id,input,items,settlement)
 from creation_variants where id=p_variant;
$$;
select lives_ok(pg_temp.creation_call(id),name||' create succeeds') from creation_variants order by name;
update creation_variants v set creation_revision=(select revision from public.transactions t where t.id=v.id);
select ok(creation_revision>1,name||' final initial revision includes item/settlement touches')
 from creation_variants where name not like 'plain-%' order by name;
select is((select r.revision from public.save_transaction(v.id,null,v.input,v.items,v.settlement) r),v.creation_revision,
 v.name||' untouched replay returns exactly the creation token') from creation_variants v order by name;
create temp table creation_item_ids as select id from public.expense_items;
select lives_ok(pg_temp.creation_call(id),name||' repeated replay remains read-only') from creation_variants order by name;
select is((select count(*) from public.expense_items where id in(select id from creation_item_ids)),
 (select count(*) from creation_item_ids),'replays preserve all original item identities');

select pg_temp.seed_needs_attention('e2100000-0000-4000-8000-000000000001',true);
select lives_ok(pg_temp.creation_call(id),name||' unchanged replay accepts the now-archived original wallet')
 from creation_variants order by name;
select pg_temp.seed_needs_attention('e2100000-0000-4000-8000-000000000001',false);

select lives_ok(format('select * from public.set_transaction_deleted(%L,%s,true)',id,creation_revision),name||' delete succeeds')
 from creation_variants where name like '%-restore' order by name;
select lives_ok(format('select * from public.set_transaction_deleted(%L,(select revision from public.transactions where id=%L),false)',id,id),name||' restore succeeds')
 from creation_variants where name like '%-restore' order by name;
select throws_ok(pg_temp.creation_call(id),'BT003','transaction conflict',name||' original create retry after delete/restore conflicts')
 from creation_variants where name like '%-restore' order by name;

select lives_ok(format('select * from public.save_transaction(%L,%s,%L::jsonb,null,null)',id,creation_revision,
 input||'{"note":"Temporary edit"}'::jsonb),name||' edit succeeds')
 from creation_variants where name like '%-edit' order by name;
select lives_ok(format('select * from public.save_transaction(%L,(select revision from public.transactions where id=%L),%L::jsonb,null,null)',id,id,input),
 name||' revert restores the original visible payload') from creation_variants where name like '%-edit' order by name;
select throws_ok(pg_temp.creation_call(id),'BT003','transaction conflict',name||' original create retry after edit/revert conflicts')
 from creation_variants where name like '%-edit' order by name;
select throws_ok(format('select * from cashier_private.save_transaction_aggregate(%L,null,%L::jsonb,%L::jsonb,%L::jsonb)',
 id,input,items,settlement),'BT003','transaction conflict',name||' private aggregate cannot bypass the generation guard')
 from creation_variants order by name;
select throws_ok(format('select * from public.set_transaction_deleted(%L,%s,true)',id,creation_revision),
 'BT003','transaction conflict',name||' original Undo still cannot delete a later generation') from creation_variants order by name;
select is((select count(*) from public.transactions where deleted_at is null),6::bigint,'failed old requests leave all later live generations intact');
select is((select sum(amount_minor)::bigint from public.transactions where deleted_at is null),30000::bigint,'old requests add no extra expense');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id='e2100000-0000-4000-8000-000000000001'),-30000::bigint,
 'each settled/itemized/plain parent contributes its net cost only once');

-- Legacy/direct rows are editable but do not acquire a guessed creation token.
insert into public.transactions(id,kind,occurred_on,balance_id,amount_minor,currency,category_id,note)
 select 'e2200000-0000-4000-8000-000000000099','expense','2026-11-04','e2100000-0000-4000-8000-000000000001',5000,'USD',
 (input->>'categoryId')::uuid,'Creation fixture' from creation_variants limit 1;
select throws_ok(format('select * from public.save_transaction(%L,null,%L::jsonb,''[]''::jsonb,null)',
 'e2200000-0000-4000-8000-000000000099',(select input from creation_variants limit 1)),
 'BT003','transaction conflict','missing receipt conflicts without guessing or backfill');

-- Private storage and the unreceipted row writer must not be client bypasses.
select ok(not has_table_privilege('authenticated','transaction_private.transaction_creation_receipts','insert'),
 'authenticated cannot fabricate creation receipts');
select ok(not has_table_privilege('authenticated','transaction_private.transaction_creation_receipts','select'),
 'receipt storage is not exposed to app readers');
select ok(not has_table_privilege('authenticated','transaction_private.transaction_creation_receipts','update'),
 'authenticated cannot advance creation receipts');
select ok(not has_table_privilege('authenticated','transaction_private.transaction_creation_receipts','delete'),
 'authenticated cannot erase creation receipts');
select ok(not has_function_privilege('authenticated','transaction_private.save_transaction_rows(uuid,integer,jsonb,jsonb)','execute'),
 'authenticated cannot bypass receipts through the private row writer');
select ok(not has_function_privilege('authenticated','transaction_private.save_transaction(uuid,integer,jsonb,jsonb)','execute'),
 'cashier extension disables the old four-argument aggregate entry point');
select ok(not (select prosecdef from pg_proc where oid='public.save_transaction(uuid,integer,jsonb,jsonb,jsonb)'::regprocedure),
 'public canonical entry remains invoker-security');

select set_config('request.jwt.claims','{"sub":"e2000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
with fixture(id,name,kind,currency) as (values ('e2100000-0000-4000-8000-000000000002','B cash','cash','USD')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
create temp table creation_b_input as select jsonb_build_object('kind','expense','occurredOn','2026-11-04',
 'balanceId','e2100000-0000-4000-8000-000000000002','categoryId',id,'amountMinor',5000,'note','Creation fixture') as value
 from public.categories where kind='expense' and parent_id is null order by position limit 1;
select throws_ok(format('select * from public.save_transaction(%L,null,%L::jsonb,''[]''::jsonb,null)',
 (select id from creation_variants where name='plain-edit'),(select value from creation_b_input)),
 'BT003','transaction conflict','definer capability does not let another tenant claim an existing UUID');
select throws_ok(format('select * from public.save_transaction(%L,null,%L::jsonb,''[]''::jsonb,null)',
 'e2200000-0000-4000-8000-000000000098',(select value from creation_b_input)||'{"balanceId":"e2100000-0000-4000-8000-000000000001"}'),
 'P0001','wallet unavailable','definer aggregate still rejects a foreign source wallet');
select is((select count(*) from public.transactions),0::bigint,'foreign retries create or expose no transactions');

reset role;
select is((select r.creation_revision from transaction_private.transaction_creation_receipts r where r.transaction_id=v.id),v.creation_revision,
 v.name||' immutable receipt retains the actual final creation revision') from creation_variants v order by name;
select throws_ok($$update transaction_private.transaction_creation_receipts set creation_revision=creation_revision+1$$,
 '22023','creation receipt immutable','receipt revisions cannot be rewritten even by accidental privileged maintenance');
select throws_ok($$delete from transaction_private.transaction_creation_receipts$$,
 '22023','creation receipt immutable','receipt tombstones cannot be erased while the account exists');
delete from public.transactions where id=(select id from creation_variants where name='plain-edit');
select set_config('request.jwt.claims','{"sub":"e2000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(pg_temp.creation_call(id),'BT003','transaction conflict','a physical parent purge retains the creation tombstone')
 from creation_variants where name='plain-edit';
reset role;
select lives_ok($$delete from auth.users where id='e2000000-0000-4000-8000-000000000001'$$,
 'actual account cleanup can remove immutable receipt tombstones');
select is((select count(*) from transaction_private.transaction_creation_receipts where user_id='e2000000-0000-4000-8000-000000000001'),
 0::bigint,'account cleanup leaves no private receipt orphan');
select * from finish();
rollback;
