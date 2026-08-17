-- H0 — observability without a new sidecar table.
-- Additive only:
--   * two nullable columns on existing log tables (no rewrite, no default)
--   * one read-only view
--   * three retention cleanup functions
-- Nothing here writes data, drops anything, or changes an existing ACL.

ALTER TABLE public.cron_dispatch_log ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE public.edge_boot_events  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS cron_dispatch_log_cid_idx
  ON public.cron_dispatch_log (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS edge_boot_events_cid_idx
  ON public.edge_boot_events (correlation_id) WHERE correlation_id IS NOT NULL;

-- cron run -> dispatch -> edge boot -> attempt -> write -> coverage, joined by
-- correlation_id where present and by (jobname/fn, time window) as the fallback.
CREATE OR REPLACE VIEW public.freshness_run_trace AS
WITH runs AS (
  SELECT d.correlation_id,
         d.jobname,
         d.request_id,
         d.dispatched_at,
         (SELECT max(b.boot_at) FROM public.edge_boot_events b
           WHERE (b.correlation_id = d.correlation_id AND d.correlation_id IS NOT NULL)
              OR (b.correlation_id IS NULL
                  AND b.boot_at BETWEEN d.dispatched_at AND d.dispatched_at + interval '5 minutes')
         ) AS boot_at
  FROM public.cron_dispatch_log d
)
SELECT r.correlation_id,
       r.jobname,
       r.request_id,
       r.dispatched_at,
       r.boot_at,
       count(a.id)                                            AS attempts,
       count(*) FILTER (WHERE a.outcome = 'success')           AS attempts_ok,
       count(*) FILTER (WHERE a.outcome IS DISTINCT FROM 'success') AS attempts_failed,
       min(a.attempted_at)                                     AS first_attempt_at,
       max(a.attempted_at)                                     AS last_attempt_at,
       max(a.latency_ms)                                       AS max_latency_ms,
       array_remove(array_agg(DISTINCT a.error_class), NULL)   AS error_classes,
       array_remove(array_agg(DISTINCT a.trade_date), NULL)    AS trade_dates,
       (SELECT max(c.trade_date) FROM public.bsr_coverage_daily c
         WHERE c.trade_date = ANY (array_remove(array_agg(DISTINCT a.trade_date), NULL))
       )                                                       AS covered_trade_date
FROM runs r
LEFT JOIN public.tw_bsr_attempt_logs a
       ON (a.correlation_id = r.correlation_id AND r.correlation_id IS NOT NULL)
       OR (r.correlation_id IS NULL AND a.attempted_at BETWEEN r.dispatched_at
                                     AND r.dispatched_at + interval '30 minutes')
GROUP BY r.correlation_id, r.jobname, r.request_id, r.dispatched_at, r.boot_at;

REVOKE ALL ON public.freshness_run_trace FROM PUBLIC;
GRANT SELECT ON public.freshness_run_trace TO service_role;

-- Retention. edge_boot_events already holds 452k rows / 110 MB with no cleanup.
CREATE OR REPLACE FUNCTION public.cleanup_old_edge_boot_events(p_days integer DEFAULT 30)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.edge_boot_events WHERE boot_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_old_bsr_attempt_logs(p_days integer DEFAULT 60)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.tw_bsr_attempt_logs WHERE attempted_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_old_cron_dispatch_log(p_days integer DEFAULT 30)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.cron_dispatch_log WHERE dispatched_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.cleanup_old_edge_boot_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_old_bsr_attempt_logs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_old_cron_dispatch_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_edge_boot_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_bsr_attempt_logs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_cron_dispatch_log(integer) TO service_role;
