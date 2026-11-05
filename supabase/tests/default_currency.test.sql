-- Synthetic fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email) values
  ('c7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'default-currency@example.test');

select is((select default_currency from public.profiles where user_id = 'c7000000-0000-4000-8000-000000000001'), null, 'new profiles have no default currency');
update public.profiles set default_currency = 'LBP' where user_id = 'c7000000-0000-4000-8000-000000000001';
select is((select default_currency from public.profiles where user_id = 'c7000000-0000-4000-8000-000000000001'), 'LBP', 'a catalog currency can be the default');
select throws_ok($$update public.profiles set default_currency = 'NOPE' where user_id = 'c7000000-0000-4000-8000-000000000001'$$, '23503', null, 'an unknown currency cannot be the default');
select * from finish();
rollback;
