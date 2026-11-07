-- Whether pressing "Got salary" emails the wallet summary. On by default; the
-- owner switches it off in Settings. Covered by the existing profile RLS.
alter table public.profiles add column salary_email_enabled boolean not null default true;
