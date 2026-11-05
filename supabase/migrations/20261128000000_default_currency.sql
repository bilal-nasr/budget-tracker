-- The currency the home screen opens on (and lists first). Nullable: with no
-- choice the app uses the first enabled currency. Follows renames of the
-- currency code and clears itself when the currency is removed.
alter table public.profiles add column default_currency text;
alter table public.profiles
  add constraint profiles_default_currency_fk
  foreign key (user_id, default_currency) references public.currencies (user_id, code)
  on update cascade on delete set null (default_currency);
