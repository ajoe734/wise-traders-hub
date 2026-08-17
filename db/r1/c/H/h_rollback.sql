-- Stage rollback for H0/H1/H2. Drops only objects this stage created.
DROP FUNCTION IF EXISTS public.decay_symbol_demand();
DROP FUNCTION IF EXISTS public.register_symbol_demand(text[], text);
DROP TABLE IF EXISTS public.symbol_demand_registry;

DROP FUNCTION IF EXISTS public.upsert_tw_market_symbols(jsonb);
DROP TRIGGER IF EXISTS tw_market_symbols_touch_trg ON public.tw_market_symbols;
DROP TABLE IF EXISTS public.tw_market_symbols;
DROP FUNCTION IF EXISTS public.tw_market_symbols_touch();

DROP FUNCTION IF EXISTS public.cleanup_old_cron_dispatch_log(integer);
DROP FUNCTION IF EXISTS public.cleanup_old_bsr_attempt_logs(integer);
DROP FUNCTION IF EXISTS public.cleanup_old_edge_boot_events(integer);
DROP VIEW IF EXISTS public.freshness_run_trace;

DROP INDEX IF EXISTS public.edge_boot_events_cid_idx;
DROP INDEX IF EXISTS public.cron_dispatch_log_cid_idx;
ALTER TABLE public.edge_boot_events  DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE public.cron_dispatch_log DROP COLUMN IF EXISTS correlation_id;
