-- Adds the "transfer" kind. Kept in its own migration so the new enum value
-- is committed before the next migration uses it.
alter type public.txn_kind add value if not exists 'transfer';
