-- Fills an existing, EMPTY demo account with synthetic data, acting as that user
-- (role authenticated + JWT claims) so RLS and the app's own RPCs apply.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v email=demo@budget.com -f scripts/seed-demo.sql
-- One transaction: any failure rolls everything back. Synthetic data only.
\set QUIET on
begin;

select id as uid from auth.users where email = :'email' \gset
\if :{?uid}
\else
  \echo 'No such user:' :email
  \quit
\endif

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true);

-- The app sends its currency units as the x-budget-units request header; the
-- database refuses money writes without it. Same value, taken from the catalog.
select set_config('request.headers',
  json_build_object('x-budget-units', (select json_object_agg(code, decimal_places)::text from public.currencies))::text, true);

do $seed$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Beirut')::date;
  pocket uuid; bank uuid; card uuid; lira uuid;
  cycle1 uuid; cycle2 uuid; inst uuid; rent uuid; req uuid;
  r record;
  cat_id uuid;
begin
  if uid is null then raise exception 'no authenticated user'; end if;
  if exists (select 1 from public.wallets) then raise exception 'account is not empty; refusing to seed'; end if;

  -- Wallets ---------------------------------------------------------------
  perform public.create_wallet('Pocket cash', 'cash', 'USD', 25000);
  perform public.create_wallet('Bank account', 'bank', 'USD', 240000);
  perform public.create_wallet('Credit card', 'card', 'USD', 0);
  perform public.create_wallet('Lira cash', 'cash', 'LBP', 4000000);

  select b.id into pocket from public.wallet_balances b join public.wallets w on w.id = b.wallet_id where w.name = 'Pocket cash' and b.currency = 'USD';
  select b.id into bank   from public.wallet_balances b join public.wallets w on w.id = b.wallet_id where w.name = 'Bank account' and b.currency = 'USD';
  select b.id into card   from public.wallet_balances b join public.wallets w on w.id = b.wallet_id where w.name = 'Credit card' and b.currency = 'USD';
  select b.id into lira   from public.wallet_balances b join public.wallets w on w.id = b.wallet_id where w.name = 'Lira cash' and b.currency = 'LBP';

  update public.profiles set default_currency = 'USD', onboarded_at = now(),
    salary_amount_minor = 180000, salary_balance_id = bank where user_id = uid;

  -- Salary (two cycles) with a Laptop installment payment in each -------------
  req := gen_random_uuid();
  perform public.receive_salary(req, null);
  update public.transactions set occurred_on = today - 36 where id = req and source = 'salary';
  cycle1 := req;

  insert into public.installments (name, total_minor, paid_before_minor, balance_id, category_id, monthly_minor, due_day, position)
  values ('Laptop', 120000, 0, bank, (select id from public.categories where name_en = 'Shopping'), 10000, 15, extract(epoch from now())::bigint)
  returning id into inst;
  perform public.record_installment_payment(gen_random_uuid(), inst, bank, 10000, today - 35, cycle1, null);

  req := gen_random_uuid();
  perform public.receive_salary(req, cycle1);
  update public.transactions set occurred_on = today - 6 where id = req and source = 'salary';
  cycle2 := req;
  perform public.record_installment_payment(gen_random_uuid(), inst, bank, 10000, today - 5, cycle2, null);

  -- Expenses and income -------------------------------------------------------
  for r in
    select * from (values
      (0,  'pocket', 'Eating out',   1250,    'Coffee',             'expense', null::jsonb),
      (1,  'pocket', 'Groceries',    5420,    'Supermarket',        'expense', '[{"description":"Phone credits","amountMinor":2000},{"description":"For sister","amountMinor":3000}]'::jsonb),
      (2,  'card',   'Eating out',   2800,    'Lunch with friends', 'expense', null),
      (3,  'lira',   'Transport',    400000,  'Taxi',               'expense', null),
      (4,  'bank',   'Bills',        4500,    'Generator bill',     'expense', null),
      (5,  'card',   'Fun',          1500,    'Cinema',             'expense', null),
      (6,  'card',   'Groceries',    7210,    'Vegetables',         'expense', null),
      (7,  'lira',   'Health',       1200000, 'Pharmacy',           'expense', null),
      (8,  'card',   'Eating out',   4200,    'Dinner',             'expense', null),
      (9,  'lira',   'Transport',    300000,  'Taxi',               'expense', null),
      (10, 'card',   'Shopping',     6400,    'Shoes',              'expense', null),
      (11, 'bank',   'Bills',        3000,    'Internet',           'expense', null),
      (12, 'bank',   'Other income', 25000,   'Freelance gig',      'income',  null),
      (13, 'pocket', 'Groceries',    3980,    'Bakery and dairy',   'expense', null),
      (15, 'pocket', 'Eating out',   1500,    'Shawarma',           'expense', null),
      (16, 'bank',   'Education',    8000,    'Online course',      'expense', null),
      (17, 'pocket', 'Transport',    2500,    'Fuel',               'expense', null),
      (19, 'bank',   'Bills',        12000,   'Electricity',        'expense', null),
      (20, 'card',   'Groceries',    6800,    'Weekly shop',        'expense', null),
      (21, 'pocket', 'Other',        900,     null,                 'expense', null),
      (22, 'card',   'Fun',          3000,    'Game',               'expense', null),
      (24, 'card',   'Eating out',   3600,    'Brunch',             'expense', null),
      (26, 'card',   'Health',       6500,    'Dentist checkup',    'expense', null),
      (28, 'pocket', 'Groceries',    4500,    null,                 'expense', null),
      (29, 'card',   'Shopping',     5500,    'T-shirts',           'expense', null),
      (30, 'lira',   'Transport',    250000,  'Taxi',               'expense', null),
      (33, 'bank',   'Other income', 12000,   'Sold old phone',     'income',  null),
      (34, 'bank',   'Bills',        4500,    'Generator bill',     'expense', null),
      (35, 'card',   'Groceries',    8200,    'Supermarket',        'expense', null),
      (37, 'card',   'Fun',          2000,    'Bowling',            'expense', null),
      (38, 'pocket', 'Eating out',   2200,    null,                 'expense', null),
      (41, 'bank',   'Bills',        3000,    'Internet',           'expense', null),
      (42, 'pocket', 'Groceries',    5100,    null,                 'expense', null),
      (44, 'pocket', 'Transport',    2500,    'Fuel',               'expense', null)
    ) as t(days_ago, wallet, category, amount, note, kind, items)
  loop
    select id into cat_id from public.categories where name_en = r.category and archived_at is null;
    perform public.save_transaction(gen_random_uuid(), null::int, jsonb_build_object(
      'kind', r.kind, 'occurredOn', (today - r.days_ago)::text,
      'balanceId', case r.wallet when 'pocket' then pocket when 'bank' then bank when 'card' then card else lira end,
      'amountMinor', r.amount, 'categoryId', cat_id, 'note', r.note), r.items, null::jsonb);
  end loop;

  -- Transfers -------------------------------------------------------------------
  perform public.record_balance_transfer(gen_random_uuid(), today - 2, bank, pocket, 20000, 20000, 'Cash for the week', null);
  perform public.record_balance_transfer(gen_random_uuid(), today - 8, pocket, lira, 5000, 4475000, 'Exchange', 89500);

  -- Fixed expenses (Rent share is paid this month) ------------------------------
  insert into public.fixed_expenses (name, amount_minor, balance_id, category_id, due_day, items, position)
  select v.name, v.amount, v.bal, (select id from public.categories where name_en = v.category), v.due_day, '[]'::jsonb,
         extract(epoch from now())::bigint + v.ord
  from (values ('Rent share', 40000, bank, 'Rent', 1, 0), ('Internet', 3000, bank, 'Bills', 5, 1),
               ('Generator', 4500, pocket, 'Bills', 10, 2), ('Gym', 3500, card, 'Health', 15, 3)) as v(name, amount, bal, category, due_day, ord);
  select id into rent from public.fixed_expenses where name = 'Rent share';
  perform public.pay_fixed_expense(rent);

  -- Budgets (this month, USD) ---------------------------------------------------
  insert into public.budgets (user_id, category_id, currency, starts_month, limit_minor)
  select uid, c.id, 'USD', date_trunc('month', today)::date, v.lim
  from (values ('Groceries', 30000), ('Eating out', 10000), ('Transport', 12000), ('Fun', 5000),
               ('Shopping', 12000), ('Health', 8000), ('Bills', 25000)) as v(name, lim)
  join public.categories c on c.name_en = v.name and c.archived_at is null;
end
$seed$;

commit;
\echo 'Seeded.' :email
