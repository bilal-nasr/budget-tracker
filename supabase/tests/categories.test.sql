-- Synthetic fixtures only. Run on the coordinated disposable local database.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email) values
 ('ca000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','category-a@example.test'),
 ('cb000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','category-b@example.test');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.categories),12::bigint,'each account receives its own 12 editable defaults');
select is((select tile from public.categories where name_en='Groceries'),9::smallint,'new accounts receive the meaningful groceries icon');

reset role;
update public.categories
set tile = case name_en
  when 'Groceries' then 3
  when 'Transport' then 2
  when 'Eating out' then 4
  when 'Bills' then 1
  when 'Shopping' then 5
  else tile
end,
created_at = '2026-01-01 00:00:00+00'
where user_id in (
  'ca000000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000002'
);
update public.categories
set created_at = '2026-01-02 00:00:00+00'
where user_id = 'cb000000-0000-4000-8000-000000000002'
  and name_en = 'Groceries';
select public.upgrade_default_category_icons();
select is(
  (select tile from public.categories where user_id='ca000000-0000-4000-8000-000000000001' and name_en='Groceries'),
  9::smallint,
  'a complete original bootstrap cohort upgrades'
);
select is(
  (select tile from public.categories where user_id='cb000000-0000-4000-8000-000000000002' and name_en='Groceries'),
  3::smallint,
  'a recreated or otherwise incomplete cohort keeps its chosen icon'
);
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($test$
  select public.reorder_categories(
    'expense',
    (select array_agg(id order by position desc) from public.categories
     where kind='expense' and parent_id is null and archived_at is null)
  )
$test$,'an authenticated owner can atomically reverse a complete category order');
select is((select name_en from public.categories where kind='expense' and position=1),'Other','reordering renumbers categories from one in the requested order');
select throws_ok($test$
  select public.reorder_categories(
    'expense',
    array[(select id from public.categories where kind='expense' and archived_at is null limit 1)]
  )
$test$,'P0001','category_order_invalid','an incomplete order cannot overwrite the catalogue');
update public.categories set archived_at=now() where kind='expense' and name_en='Other';
update public.categories set archived_at=null where kind='expense' and name_en='Other';
select is((select position from public.categories where kind='expense' and name_en='Other'),11,'restoring an archived root appends it after the active order');

insert into public.categories (id,kind,name_en,tile,color) values
 ('ca100000-0000-4000-8000-000000000001','expense',E'  Phone\t credits  ',1,'teal'),
 ('ca100000-0000-4000-8000-000000000002','expense','Budget history',2,'ochre'),
 ('ca100000-0000-4000-8000-000000000003','expense','Deleted transaction',3,'teal'),
 ('ca100000-0000-4000-8000-000000000004','expense','Fixed category',4,'teal'),
 ('ca100000-0000-4000-8000-000000000005','expense','Installment category',5,'teal'),
 ('ca100000-0000-4000-8000-000000000006','expense','Parent category',6,'teal');
select is((select name_en from public.categories where id='ca100000-0000-4000-8000-000000000001'),'Phone credits','stored names normalize whitespace');
select throws_ok($$insert into public.categories(kind,name_en,tile,color) values('expense','PHONE credits',1,'teal')$$,'23505',null,'active names are unique per language and root scope');
select lives_ok($$insert into public.categories(kind,name_en,tile,color) values('income','PHONE credits',1,'teal')$$,'same name is allowed in another kind');
select lives_ok($$insert into public.categories(kind,name_ar,tile,color) values('expense','اسم خاص',1,'teal')$$,'Arabic-only custom names are supported');
select throws_ok($$insert into public.categories(kind,name_ar,tile,color) values('expense',' اسم خاص ',1,'teal')$$,'23505',null,'Arabic names use the same whitespace uniqueness rule');
select throws_ok($$insert into public.categories(kind,name_en,name_ar,tile,color) values('expense','  ',null,1,'teal')$$,'23514',null,'a nonblank name is required');
select lives_ok($$insert into public.categories(kind,name_en,tile,color) values('expense',repeat('🍎',40),1,'teal')$$,'40 Unicode code points are accepted');
select throws_ok($$insert into public.categories(kind,name_en,tile,color) values('expense',repeat('🍎',41),1,'teal')$$,'23514',null,'41 code points are rejected');
select lives_ok($$insert into public.categories(kind,name_en,tile,color) values('expense','Semantic icon',15,'teal')$$,'meaningful category icons are accepted');
select throws_ok($$insert into public.categories(kind,name_en,tile,color) values('expense','Bad tile',16,'teal')$$,'23514',null,'unknown icons are rejected');
select throws_ok($$insert into public.categories(kind,name_en,tile,color) values('expense','Bad color',1,'#fff')$$,'23514',null,'arbitrary colors are rejected');
select throws_ok($$update public.categories set kind='income' where id='ca100000-0000-4000-8000-000000000001'$$,'P0001','category_identity_immutable','kind cannot rewrite historical identity');
select throws_ok($$update public.categories set user_id='cb000000-0000-4000-8000-000000000002' where id='ca100000-0000-4000-8000-000000000001'$$,'P0001','category_identity_immutable','category ownership is immutable');

insert into public.categories(id,parent_id,kind,name_en,tile,color) values
 ('ca200000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000006','expense','Phone credits',1,'teal');
select throws_ok($$insert into public.categories(id,parent_id,kind,name_en,tile,color) values('ca200000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000002','expense','Self',1,'teal')$$,'P0001','category_parent_invalid','self-parenting is rejected');
select throws_ok($$insert into public.categories(parent_id,kind,name_en,tile,color) values('ca200000-0000-4000-8000-000000000001','expense','Grandchild',1,'teal')$$,'P0001','category_parent_invalid','existing hierarchy remains only one level');
select throws_ok($$update public.categories set parent_id='ca200000-0000-4000-8000-000000000001' where id='ca100000-0000-4000-8000-000000000006'$$,'P0001','category_identity_immutable','moving a root below its child is rejected');
select throws_ok($$select public.remove_category('ca100000-0000-4000-8000-000000000006')$$,'P0001','category_in_use','roots with existing children cannot be removed');
select throws_ok($$delete from public.categories where id='ca100000-0000-4000-8000-000000000006'$$,'P0001','category_in_use','direct DELETE cannot cascade children');

with fixture(id,name,kind,currency) as (values ('ca300000-0000-4000-8000-000000000001','Category test cash','cash','USD')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select c.id,c.user_id,c.id,f.currency,0::bigint,0 from fixture f join containers c on c.id=f.id::uuid;
insert into public.budgets(category_id,currency,starts_month,limit_minor) values('ca100000-0000-4000-8000-000000000002','USD','2026-10-01',5000);
select throws_ok($$delete from public.categories where id='ca100000-0000-4000-8000-000000000002'$$,'P0001','category_in_use','direct DELETE cannot cascade budget-only history');
select is(public.remove_category('ca100000-0000-4000-8000-000000000002'),'archived','a budget-only category archives');
select is((select limit_minor from public.month_budgets('2026-12-01') where category_id='ca100000-0000-4000-8000-000000000002'),5000::bigint,'archive preserves carried budgets');
select throws_ok($$insert into public.budgets(category_id,currency,starts_month,limit_minor) values('ca100000-0000-4000-8000-000000000002','USD','2027-01-01',7000)$$,'P0001','category_unavailable','archived categories cannot receive new positive limits');
select lives_ok($$insert into public.budgets(category_id,currency,starts_month,limit_minor) values('ca100000-0000-4000-8000-000000000002','USD','2027-01-01',null)$$,'archived budgets can explicitly be cleared');
select is((select count(*) from public.month_budgets('2027-01-01') where category_id='ca100000-0000-4000-8000-000000000002'),0::bigint,'explicit clear ends the carried limit');

insert into public.transactions(id,kind,occurred_on,balance_id,amount_minor,currency,category_id,deleted_at) values
 ('ca400000-0000-4000-8000-000000000001','expense','2026-11-04','ca300000-0000-4000-8000-000000000001',1200,'USD','ca100000-0000-4000-8000-000000000003',now());
select is(public.remove_category('ca100000-0000-4000-8000-000000000003'),'archived','soft-deleted transaction references still retain the category');
select lives_ok($$update public.transactions set deleted_at=null,note='Restored' where id='ca400000-0000-4000-8000-000000000001'$$,'restore preserves an unchanged archived category');
select lives_ok($$update public.transactions set amount_minor=1300 where id='ca400000-0000-4000-8000-000000000001'$$,'historical amount edits may keep the archived category');
select throws_ok($$insert into public.transactions(kind,occurred_on,balance_id,amount_minor,currency,category_id) values('expense','2026-11-04','ca300000-0000-4000-8000-000000000001',100,'USD','ca100000-0000-4000-8000-000000000003')$$,'P0001','category_unavailable','new expense cannot select an archive');
select throws_ok($$update public.transactions set category_id='ca100000-0000-4000-8000-000000000002' where id='ca400000-0000-4000-8000-000000000001'$$,'P0001','category_unavailable','historical edits cannot choose a different archive');
select is((select spent_minor from public.month_category_spend('2026-11-01') where category_id='ca100000-0000-4000-8000-000000000003'),1300::bigint,'archived-category spending remains in budgets exactly once');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id='ca300000-0000-4000-8000-000000000001'),(-1300)::bigint,'archive never changes the wallet ledger');

insert into public.fixed_expenses(name,amount_minor,balance_id,category_id) values('Category bill',100,'ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000004');
insert into public.installments(name,total_minor,balance_id,category_id,currency) values('Category device',1000,'ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000005','USD');
select throws_ok($$select public.remove_category('ca100000-0000-4000-8000-000000000004')$$,'P0001','category_in_use','fixed templates require reassignment');
select throws_ok($$select public.remove_category('ca100000-0000-4000-8000-000000000005')$$,'P0001','category_in_use','installment templates require reassignment');
select throws_ok($$update public.categories set archived_at=now() where id='ca100000-0000-4000-8000-000000000004'$$,'P0001','category_in_use','direct updates cannot archive a fixed template category');
select throws_ok($$insert into public.fixed_expenses(name,amount_minor,balance_id,category_id) values('Stale',100,'ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000003')$$,'P0001','category_unavailable','new fixed templates cannot use archives');
select throws_ok($$insert into public.installments(name,total_minor,balance_id,category_id,currency) values('Stale',1000,'ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000003','USD')$$,'P0001','category_unavailable','new installments cannot use archives');

select is(public.remove_category('ca100000-0000-4000-8000-000000000001'),'deleted','unused custom category is permanently removed');
select throws_ok($$select public.remove_category('ca100000-0000-4000-8000-000000000001')$$,'P0001','category_not_found','missing category never reports successful removal');
insert into public.categories(kind,name_en,tile,color) values('expense','Deleted transaction',1,'teal');
select throws_ok($$update public.categories set archived_at=null where id='ca100000-0000-4000-8000-000000000003'$$,'23505',null,'restoring an archive respects name reuse');

select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.categories where user_id='ca000000-0000-4000-8000-000000000001'),0::bigint,'B cannot read A categories');
select throws_ok($$select public.remove_category('ca100000-0000-4000-8000-000000000002')$$,'P0001','category_not_found','foreign category removal has the same response as missing');
with updated as (update public.categories set name_en='Foreign' where id='ca100000-0000-4000-8000-000000000002' returning id)
select is(count(*),0::bigint,'B cannot rename A category') from updated;
select throws_ok($$insert into public.categories(parent_id,kind,name_en,tile,color) values('ca100000-0000-4000-8000-000000000006','expense','Foreign child',1,'teal')$$,'P0001','category_parent_invalid','cross-user category parents are rejected');
select lives_ok($$insert into public.categories(kind,name_en,tile,color) values('expense','Phone credits',1,'teal')$$,'duplicate names across accounts are allowed');

reset role;
-- Even maintenance-role writes cannot create cross-owner category references.
select throws_ok($$insert into public.budgets(user_id,category_id,currency,starts_month,limit_minor) values('cb000000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000006','USD','2026-11-01',100)$$,'P0001','category_not_found','explicit owner matching also protects privileged reference writes');
set local role anon;
select throws_ok($$select public.remove_category('ca100000-0000-4000-8000-000000000002')$$,'42501',null,'anonymous callers cannot remove categories');
reset role;
select lives_ok($$delete from auth.users where id='ca000000-0000-4000-8000-000000000001'$$,'normal account cleanup still cascades its own data');
select is((select count(*) from public.categories where user_id='ca000000-0000-4000-8000-000000000001'),0::bigint,'account cleanup leaves no own category rows');
select * from finish();
rollback;
