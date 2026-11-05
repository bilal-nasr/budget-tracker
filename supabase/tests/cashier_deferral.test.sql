begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
select plan(4);
select ok((select substring(prosrc from E'(?i)begin\r?\n([^;]*;)') ~* 'set\s+constraints\s+public\.transactions_cashier_check\s*,\s*public\.cashier_changes_valid\s+deferred' from pg_proc where oid='cashier_private.save_transaction_aggregate_without_cost_currency(uuid,integer,jsonb,jsonb,jsonb)'::regprocedure), 'cashier aggregate defers both final-state constraints');
select ok(not has_function_privilege('anon','cashier_private.save_transaction_aggregate_without_cost_currency(uuid,integer,jsonb,jsonb,jsonb)','EXECUTE'), 'anonymous cannot call private aggregate');
select ok(not has_function_privilege('authenticated','cashier_private.save_transaction_aggregate_without_cost_currency(uuid,integer,jsonb,jsonb,jsonb)','EXECUTE'), 'authenticated cannot bypass public aggregate');
select is((select count(*) from pg_constraint where conname in ('transactions_cashier_check','cashier_changes_valid') and condeferrable), 2::bigint, 'both final-state constraints remain deferrable');
select * from finish();
rollback;
