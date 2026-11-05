-- Repair the aggregate installed from CRLF function bodies by 20261123000000.
-- CREATE OR REPLACE preserves owner, ACLs, signature and security attributes.
-- Defer once at the outer block: replacing cashier children is one aggregate
-- operation, and both deferred constraints still validate its final state.
do $repair$
declare
  target regprocedure := 'cashier_private.save_transaction_aggregate_without_cost_currency(uuid,integer,jsonb,jsonb,jsonb)'::regprocedure;
  definition text;
  body text;
  replacement text;
begin
  select pg_get_functiondef(target), prosrc into definition, body from pg_proc where oid=target;
  -- The older LF replacement could insert the statement into nested blocks.
  -- Remove only that exact statement, then install it once at the outer BEGIN.
  replacement := regexp_replace(body, 'set\s+constraints\s+public\.transactions_cashier_check\s*,\s*public\.cashier_changes_valid\s+deferred;', '', 'gi');
  replacement := regexp_replace(replacement, E'(^|\n)([ \t]*begin)[ \t]*\r?\n', E'\\1\\2\n  set constraints public.transactions_cashier_check, public.cashier_changes_valid deferred;\n', 'i');
  if replacement !~* E'begin\r?\n  set constraints public\.transactions_cashier_check' then
    raise exception 'Cashier aggregate outer block not found';
  end if;
  execute replace(definition, body, replacement);
end
$repair$;
