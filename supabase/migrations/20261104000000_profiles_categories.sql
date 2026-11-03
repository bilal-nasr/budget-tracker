-- Phase 2: profiles + categories, seeded for each new user by a trigger.
-- Every table is keyed by user_id and protected by row level security.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  locale text not null default 'en' check (locale in ('en', 'ar')),
  digits text not null default 'latin' check (digits in ('latin', 'arabic')),
  timezone text not null default 'Asia/Beirut',
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

create type public.category_kind as enum ('expense', 'income');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid references public.categories (id) on delete cascade,
  kind public.category_kind not null,
  name_en text check (name_en is null or char_length(btrim(name_en)) between 1 and 40),
  name_ar text check (name_ar is null or char_length(btrim(name_ar)) between 1 and 40),
  tile smallint not null check (tile between 1 and 8),
  color text not null check (color in ('teal', 'oxblood', 'ochre')),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (name_en is not null or name_ar is not null)
);

create index categories_user_idx on public.categories (user_id, kind, position)
  where archived_at is null;

-- One level of subcategories only.
create function public.categories_one_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    select 1 from public.categories p
    where p.id = new.parent_id and (p.parent_id is not null or p.user_id <> new.user_id or p.kind <> new.kind)
  ) then
    raise exception 'subcategories are one level deep and must share owner and kind';
  end if;
  return new;
end;
$$;

create trigger categories_one_level
  before insert or update on public.categories
  for each row execute function public.categories_one_level();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;

create policy profiles_select on public.profiles
  for select using (user_id = (select auth.uid()));
create policy profiles_update on public.profiles
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No insert/delete policy on profiles: the trigger below creates it.

create policy categories_select on public.categories
  for select using (user_id = (select auth.uid()));
create policy categories_insert on public.categories
  for insert with check (user_id = (select auth.uid()));
create policy categories_update on public.categories
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy categories_delete on public.categories
  for delete using (user_id = (select auth.uid()));

-- Bootstrap: a profile and the default bilingual categories for each new user.
create function public.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);

  insert into public.categories (user_id, kind, name_en, name_ar, tile, color, position) values
    (new.id, 'expense', 'Groceries',  'بقالة',   3, 'teal',    1),
    (new.id, 'expense', 'Transport',  'مواصلات', 2, 'oxblood', 2),
    (new.id, 'expense', 'Eating out', 'مطاعم',   4, 'ochre',   3),
    (new.id, 'expense', 'Bills',      'فواتير',  1, 'teal',    4),
    (new.id, 'expense', 'Health',     'صحة',     6, 'oxblood', 5),
    (new.id, 'expense', 'Rent',       'إيجار',   7, 'ochre',   6),
    (new.id, 'expense', 'Fun',        'ترفيه',   8, 'teal',    7),
    (new.id, 'expense', 'Shopping',   'تسوق',    5, 'oxblood', 8),
    (new.id, 'expense', 'Education',  'تعليم',   3, 'ochre',   9),
    (new.id, 'expense', 'Other',      'أخرى',    6, 'teal',   10),
    (new.id, 'income',  'Salary',     'راتب',    7, 'teal',    1),
    (new.id, 'income',  'Other income','دخل آخر', 1, 'ochre',   2);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.bootstrap_user();

-- The trigger function must not be callable through the API.
revoke execute on function public.bootstrap_user() from public, anon, authenticated;
revoke execute on function public.categories_one_level() from public, anon, authenticated;
