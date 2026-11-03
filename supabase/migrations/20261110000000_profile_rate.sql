-- The last USD to LBP exchange rate the owner used when moving money between
-- currencies (LBP per 1 USD). It pre-fills the next exchange and is the
-- reference rate for "≈" hints. Transactions keep only what left and arrived.

alter table public.profiles
  add column usd_lbp_rate integer
    check (usd_lbp_rate is null or usd_lbp_rate between 1 and 10000000);
