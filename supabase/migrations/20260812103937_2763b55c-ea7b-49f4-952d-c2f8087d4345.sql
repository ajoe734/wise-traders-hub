CREATE OR REPLACE FUNCTION public.bsr_backlog_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH tpe AS (
  SELECT (now() AT TIME ZONE 'Asia/Taipei')::date AS today_tw
), a AS (
  SELECT count(*)                                                        AS ready_pending_count,
         min(next_run_at)                                                AS oldest_due_since_ts,
         COALESCE(EXTRACT(epoch FROM (now() - min(next_run_at)))/3600.0, 0) AS oldest_due_since_h,
         COALESCE(EXTRACT(epoch FROM (now() - min(enqueued_at)))/3600.0, 0) AS oldest_ready_enqueued_h
    FROM public.tw_bsr_sync_queue
   WHERE status = 'pending' AND next_run_at IS NOT NULL AND next_run_at <= now()
), a_null AS (
  SELECT count(*) AS unclaimable_null_count
    FROM public.tw_bsr_sync_queue
   WHERE status = 'pending' AND next_run_at IS NULL
), b AS (
  SELECT count(*)                                                        AS deferred_count,
         min(next_run_at)                                                AS next_ready_at,
         COALESCE(EXTRACT(epoch FROM (now() - min(enqueued_at)))/3600.0, 0) AS oldest_enqueued_age_h
    FROM public.tw_bsr_sync_queue
   WHERE status = 'pending' AND next_run_at IS NOT NULL AND next_run_at > now()
), cohort AS (
  SELECT q.id, q.stock_id, q.trade_date, q.priority, q.enqueued_at, q.max_attempts
    FROM public.tw_bsr_sync_queue q
   WHERE q.status = 'failed'
     AND (q.last_error LIKE 'finmind_admission_%' OR q.last_error = 'quota_deferred')
), stocks AS (
  SELECT DISTINCT stock_id FROM cohort
), ready5 AS (
  SELECT s.stock_id, x.have5
    FROM stocks s CROSS JOIN tpe
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT f.trade_date) AS have5
        FROM public.tw_chip_fact f
       WHERE f.stock_id = s.stock_id AND f.trade_date >= tpe.today_tw - 10
    ) x
), classified AS (
  SELECT c.*,
         EXISTS (SELECT 1 FROM public.tw_chip_fact f
                  WHERE f.stock_id = c.stock_id AND f.trade_date = c.trade_date) AS has_fact,
         COALESCE(r.have5, 0) AS have5
    FROM cohort c
    LEFT JOIN ready5 r ON r.stock_id = c.stock_id
), c AS (
  SELECT count(*)                                              AS legacy_quota_failed_total,
         count(*) FILTER (WHERE has_fact)                      AS satisfied_reconcilable,
         count(*) FILTER (
           WHERE NOT has_fact
             AND (trade_date = public.expected_latest_bsr_date()
                  OR (trade_date >= (SELECT today_tw FROM tpe) - 10 AND have5 < 5))
         )                                                     AS actionable_still_required,
         count(*) FILTER (
           WHERE NOT has_fact
             AND NOT (trade_date = public.expected_latest_bsr_date()
                      OR (trade_date >= (SELECT today_tw FROM tpe) - 10 AND have5 < 5))
         )                                                     AS obsolete_retained,
         count(*) FILTER (
           WHERE NOT has_fact
             AND max_attempts < 8
             AND (trade_date = public.expected_latest_bsr_date()
                  OR (trade_date >= (SELECT today_tw FROM tpe) - 10 AND have5 < 5))
         )                                                     AS actionable_token_eligible
    FROM classified
), d AS (
  SELECT COALESCE(sum(COALESCE(row_count, 0)), 0)                                       AS tokens_issued_24h,
         COALESCE(sum(COALESCE((metadata->>'reconciled')::int, 0)), 0)                  AS reconciled_24h,
         (SELECT metadata->>'budget_reason' FROM public.data_source_refresh_logs
           WHERE source_key = 'bsr_quota_recovery' ORDER BY created_at DESC LIMIT 1)    AS last_budget_reason,
         (SELECT metadata->>'next_admission_at' FROM public.data_source_refresh_logs
           WHERE source_key = 'bsr_quota_recovery' ORDER BY created_at DESC LIMIT 1)    AS last_next_admission_at
    FROM public.data_source_refresh_logs
   WHERE source_key = 'bsr_quota_recovery' AND created_at >= now() - interval '24 hours'
)
SELECT jsonb_build_object(
  'ready', jsonb_build_object(
     'ready_pending_count', a.ready_pending_count,
     'oldest_due_since_ts', a.oldest_due_since_ts,
     'oldest_due_since_h', round(a.oldest_due_since_h::numeric, 2),
     'oldest_ready_enqueued_h', round(a.oldest_ready_enqueued_h::numeric, 2),
     'unclaimable_null_count', a_null.unclaimable_null_count
  ),
  'deferred', jsonb_build_object(
     'deferred_count', b.deferred_count,
     'next_ready_at', b.next_ready_at,
     'oldest_enqueued_age_h', round(b.oldest_enqueued_age_h::numeric, 2)
  ),
  'cohort', jsonb_build_object(
     'legacy_quota_failed_total', c.legacy_quota_failed_total,
     'satisfied_reconcilable', c.satisfied_reconcilable,
     'actionable_still_required', c.actionable_still_required,
     'actionable_token_eligible', c.actionable_token_eligible,
     'obsolete_retained', c.obsolete_retained,
     'counting_mode', 'exact'
  ),
  'audit', jsonb_build_object(
     'tokens_issued_24h', d.tokens_issued_24h,
     'reconciled_24h', d.reconciled_24h,
     'last_budget_reason', d.last_budget_reason,
     'last_next_admission_at', d.last_next_admission_at
  ),
  'generated_at', now()
)
FROM a, a_null, b, c, d;
$function$;

CREATE OR REPLACE FUNCTION public.recover_quota_failed_bsr_jobs(p_max integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_invocation uuid := gen_random_uuid();
  v_cap int := LEAST(1, GREATEST(0, COALESCE(p_max, 0)));
  v_lock boolean;
  v_before jsonb;
  v_after jsonb;
  v_budget jsonb;
  v_breason text;
  v_pools jsonb;
  v_next_admission text;
  v_today_tw date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_reconciled_id bigint;
  v_reconciled int := 0;
  v_token_id bigint;
  v_tokens int := 0;
  v_inspected int := 0;
  v_result jsonb;
  CANDIDATE_LIMIT constant int := 200;
  LOCK_KEY constant bigint := 771001;
BEGIN
  SELECT pg_try_advisory_xact_lock(LOCK_KEY) INTO v_lock;

  IF v_lock IS NOT TRUE THEN
    INSERT INTO public.data_source_refresh_logs
      (source_key, triggered_by, status, started_at, finished_at, duration_ms, row_count, metadata)
    VALUES ('bsr_quota_recovery', NULL, 'skipped', v_t0, clock_timestamp(),
            (EXTRACT(epoch FROM (clock_timestamp() - v_t0)) * 1000)::int, 0,
            jsonb_build_object('invocation_id', v_invocation, 'budget_reason', 'lock_contended',
                               'counting_mode', 'exact', 'tokens_issued', 0, 'reconciled', 0));
    RETURN jsonb_build_object('invocation_id', v_invocation, 'tokens_issued', 0, 'reconciled', 0,
                              'recovered', 0, 'budget_reason', 'lock_contended', 'counting_mode', 'exact');
  END IF;

  v_budget := public.bsr_recovery_budget(GREATEST(v_cap, 0));
  v_breason := v_budget->>'budget_reason';
  v_pools := v_budget->'pools';
  v_next_admission := v_budget->>'next_admission_at';
  v_before := v_budget->'metrics';
  v_cap := LEAST(v_cap, COALESCE((v_budget->>'budget')::int, 0));

  WITH pick AS (
    SELECT q.id
      FROM public.tw_bsr_sync_queue q
     WHERE q.status = 'failed'
       AND (q.last_error LIKE 'finmind_admission_%' OR q.last_error = 'quota_deferred')
       AND EXISTS (SELECT 1 FROM public.tw_chip_fact f
                    WHERE f.stock_id = q.stock_id AND f.trade_date = q.trade_date)
     ORDER BY q.trade_date DESC, q.enqueued_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.tw_bsr_sync_queue q
     SET status = 'done',
         last_error = 'reconciled_fact_exists',
         finished_at = now(),
         last_success_at = COALESCE(q.last_success_at, now()),
         updated_at = now()
    FROM pick
   WHERE q.id = pick.id
  RETURNING q.id INTO v_reconciled_id;

  IF v_reconciled_id IS NOT NULL THEN v_reconciled := 1; END IF;

  IF v_cap > 0 THEN
    WITH cand AS (
      SELECT q.id, q.stock_id, q.trade_date, q.priority, q.enqueued_at
        FROM public.tw_bsr_sync_queue q
       WHERE q.status = 'failed'
         AND (q.last_error LIKE 'finmind_admission_%' OR q.last_error = 'quota_deferred')
         AND q.max_attempts < 8
         AND NOT EXISTS (SELECT 1 FROM public.tw_chip_fact f
                          WHERE f.stock_id = q.stock_id AND f.trade_date = q.trade_date)
       ORDER BY q.trade_date DESC, q.enqueued_at ASC
       LIMIT CANDIDATE_LIMIT
    ),
    ready5 AS (
      SELECT s.stock_id, x.have5
        FROM (SELECT DISTINCT stock_id FROM cand) s
        CROSS JOIN LATERAL (
          SELECT count(DISTINCT f.trade_date) AS have5
            FROM public.tw_chip_fact f
           WHERE f.stock_id = s.stock_id AND f.trade_date >= v_today_tw - 10
        ) x
    ),
    actionable AS (
      SELECT c.id, c.trade_date, c.enqueued_at,
             CASE WHEN c.priority <= 1 THEN 'interactive'
                  WHEN c.priority = 2 THEN 'keepwarm'
                  ELSE 'backfill' END AS pool
        FROM cand c
        LEFT JOIN ready5 r ON r.stock_id = c.stock_id
       WHERE c.trade_date = public.expected_latest_bsr_date()
          OR (c.trade_date >= v_today_tw - 10 AND COALESCE(r.have5, 0) < 5)
    ),
    eligible AS (
      SELECT a.id
        FROM actionable a
        JOIN jsonb_array_elements(COALESCE(v_pools, '[]'::jsonb)) p
          ON p->>'pool' = a.pool AND (p->>'issue_ok')::boolean
       ORDER BY a.trade_date DESC, a.enqueued_at ASC
       LIMIT v_cap
    ),
    locked AS (
      SELECT q.id FROM public.tw_bsr_sync_queue q
       WHERE q.id IN (SELECT id FROM eligible)
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.tw_bsr_sync_queue q
       SET status = 'pending',
           max_attempts = q.max_attempts + 1,
           next_run_at = now(),
           started_at = NULL,
           finished_at = NULL,
           last_error = 'quota_recovery_token',
           updated_at = now()
      FROM locked
     WHERE q.id = locked.id
    RETURNING q.id INTO v_token_id;

    IF v_token_id IS NOT NULL THEN v_tokens := 1; END IF;

    SELECT LEAST(count(*), CANDIDATE_LIMIT) INTO v_inspected
      FROM public.tw_bsr_sync_queue q
     WHERE q.status = 'failed'
       AND (q.last_error LIKE 'finmind_admission_%' OR q.last_error = 'quota_deferred');
  END IF;

  v_after := public.bsr_backlog_metrics();

  INSERT INTO public.data_source_refresh_logs
    (source_key, triggered_by, status, started_at, finished_at, duration_ms, row_count, metadata)
  VALUES ('bsr_quota_recovery', NULL,
          CASE WHEN v_tokens > 0 OR v_reconciled > 0 THEN 'success' ELSE 'skipped' END,
          v_t0, clock_timestamp(),
          (EXTRACT(epoch FROM (clock_timestamp() - v_t0)) * 1000)::int,
          v_tokens,
          jsonb_build_object(
            'invocation_id', v_invocation,
            'budget_reason', v_breason,
            'degrade', v_budget->'degrade',
            'pools', v_pools,
            'pool_excluded', jsonb_build_array('interactive'),
            'counting_mode', 'exact',
            'candidates_inspected', v_inspected,
            'cap', v_cap,
            'tokens_issued', v_tokens,
            'reconciled', v_reconciled,
            'tokened_job_ids', CASE WHEN v_token_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_token_id) END,
            'reconciled_job_ids', CASE WHEN v_reconciled_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_reconciled_id) END,
            'metrics_before', v_before,
            'metrics_after', v_after,
            'next_admission_at', v_next_admission,
            'total_ms', (EXTRACT(epoch FROM (clock_timestamp() - v_t0)) * 1000)::int
          ));

  v_result := jsonb_build_object(
    'invocation_id', v_invocation,
    'tokens_issued', v_tokens,
    'reconciled', v_reconciled,
    'budget_reason', v_breason,
    'counting_mode', 'exact',
    'cap', v_cap,
    'candidates_inspected', v_inspected,
    'tokened_job_ids', CASE WHEN v_token_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_token_id) END,
    'reconciled_job_ids', CASE WHEN v_reconciled_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_reconciled_id) END,
    'next_admission_at', v_next_admission,
    'metrics_after', v_after
  );

  RETURN v_result || jsonb_build_object(
    'recovered', v_tokens,
    'remaining', COALESCE((v_after#>>'{cohort,legacy_quota_failed_total}')::int, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bsr_backlog_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bsr_backlog_metrics() TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) TO service_role;