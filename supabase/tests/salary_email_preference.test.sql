-- Synthetic fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email) values
  ('c8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'salary-email-a@example.test'),
  ('c8000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'salary-email-b@example.test');

select is((select salary_email_enabled from public.profiles where user_id = 'c8000000-0000-4000-8000-000000000001'), true, 'new profiles get the salary email by default');

update public.profiles set salary_email_enabled = false where user_id = 'c8000000-0000-4000-8000-000000000001';
select is((select salary_email_enabled from public.profiles where user_id = 'c8000000-0000-4000-8000-000000000001'), false, 'the owner can switch it off');
select is((select salary_email_enabled from public.profiles where user_id = 'c8000000-0000-4000-8000-000000000002'), true, 'another account is unaffected');
select throws_ok($$update public.profiles set salary_email_enabled = null where user_id = 'c8000000-0000-4000-8000-000000000001'$$, '23502', null, 'the preference cannot be null');

select * from finish();
rollback;
