-- Add meaningful category icons while preserving the original eight motifs.
alter table public.categories drop constraint categories_tile_check;
alter table public.categories add constraint categories_tile_check check (tile between 1 and 15);

-- Upgrade only a complete, untouched bootstrap cohort. The shared created_at
-- value and full 12-row fingerprint prevent a recreated/custom category with a
-- familiar name from being mistaken for one of the original defaults.
create function public.upgrade_default_category_icons()
returns void
language sql
set search_path = ''
as $$
  with canonical(kind, name_en, name_ar, old_tile, color, new_tile) as (
    values
      ('expense'::public.category_kind, 'Groceries'::text,   'بقالة'::text,    3::smallint, 'teal'::text,    9::smallint),
      ('expense',                       'Transport',         'مواصلات',        2::smallint, 'oxblood',      14::smallint),
      ('expense',                       'Eating out',        'مطاعم',          4::smallint, 'ochre',        15::smallint),
      ('expense',                       'Bills',             'فواتير',         1::smallint, 'teal',         10::smallint),
      ('expense',                       'Health',            'صحة',            6::smallint, 'oxblood',      null::smallint),
      ('expense',                       'Rent',              'إيجار',          7::smallint, 'ochre',        null::smallint),
      ('expense',                       'Fun',               'ترفيه',          8::smallint, 'teal',         null::smallint),
      ('expense',                       'Shopping',          'تسوق',           5::smallint, 'oxblood',      11::smallint),
      ('expense',                       'Education',         'تعليم',          3::smallint, 'ochre',        null::smallint),
      ('expense',                       'Other',             'أخرى',           6::smallint, 'teal',         null::smallint),
      ('income',                        'Salary',            'راتب',           7::smallint, 'teal',         null::smallint),
      ('income',                        'Other income',      'دخل آخر',        1::smallint, 'ochre',        null::smallint)
  ), eligible as (
    select c.user_id, c.created_at
    from public.categories c
    join canonical d
      on d.kind = c.kind
     and d.name_en = c.name_en
     and d.name_ar = c.name_ar
     and d.old_tile = c.tile
     and d.color = c.color
    where c.parent_id is null
    group by c.user_id, c.created_at
    having count(*) = 12
  )
  update public.categories c
  set tile = d.new_tile
  from canonical d, eligible e
  where d.new_tile is not null
    and c.user_id = e.user_id
    and c.created_at = e.created_at
    and c.kind = d.kind
    and c.name_en = d.name_en
    and c.name_ar = d.name_ar
    and c.tile = d.old_tile
    and c.color = d.color
    and c.parent_id is null;
$$;

revoke all on function public.upgrade_default_category_icons() from public, anon, authenticated;
select public.upgrade_default_category_icons();

create or replace function public.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);

  insert into public.categories (user_id, kind, name_en, name_ar, tile, color, position) values
    (new.id, 'expense', 'Groceries',  'بقالة',    9, 'teal',    1),
    (new.id, 'expense', 'Transport',  'مواصلات', 14, 'oxblood', 2),
    (new.id, 'expense', 'Eating out', 'مطاعم',   15, 'ochre',   3),
    (new.id, 'expense', 'Bills',      'فواتير',  10, 'teal',    4),
    (new.id, 'expense', 'Health',     'صحة',      6, 'oxblood', 5),
    (new.id, 'expense', 'Rent',       'إيجار',    7, 'ochre',   6),
    (new.id, 'expense', 'Fun',        'ترفيه',    8, 'teal',    7),
    (new.id, 'expense', 'Shopping',   'تسوق',    11, 'oxblood', 8),
    (new.id, 'expense', 'Education',  'تعليم',    3, 'ochre',   9),
    (new.id, 'expense', 'Other',      'أخرى',     6, 'teal',   10),
    (new.id, 'income',  'Salary',     'راتب',     7, 'teal',    1),
    (new.id, 'income',  'Other income','دخل آخر', 1, 'ochre',   2);

  return new;
end;
$$;
