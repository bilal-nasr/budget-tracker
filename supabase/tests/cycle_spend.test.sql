-- Synthetic fixtures only. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(has_function_privilege('authenticated', 'public.category_spend_between(date,date)', 'execute'), 'signed-in users may read cycle spending');
select ok(not has_function_privilege('anon', 'public.category_spend_between(date,date)', 'execute'), 'anonymous callers may not');
select is((select count(*) from public.category_spend_between('2026-11-27', null)), 0::bigint, 'an empty account has no spending in the open cycle');
select * from finish();
rollback;
