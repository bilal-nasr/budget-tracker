-- Deferred catalog checks also run after the auth user hook returns to the auth
-- database role. Inspect only the row owner under the function owner's rights;
-- keep the empty search_path, trigger-only invocation and existing ACLs.
alter function ledger_private.global_coverage_guard() security definer;
