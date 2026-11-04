-- Enum additions must commit before the following migration uses the value.
alter type public.txn_kind add value if not exists 'loan';
