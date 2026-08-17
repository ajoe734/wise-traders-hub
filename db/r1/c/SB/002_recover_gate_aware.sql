\set ON_ERROR_STOP on
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
       -- Stage B v6 §1: terminal provider rejections are only recoverable
       -- when the admission gate is EXPLICITLY open (JSON false).
       AND (q.last_error <> 'finmind_admission_provider_plan_rejected'
            OR private_bsr.gate_explicit_open())
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
       -- Stage B v6 §1: terminal provider rejections are only recoverable
       -- when the admission gate is EXPLICITLY open (JSON false).
       AND (q.last_error <> 'finmind_admission_provider_plan_rejected'
            OR private_bsr.gate_explicit_open())
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
$function$

-- ---------------------------------------------------------------------------
-- Stage B v6 §1b (B6 failure ledger F-02): recover_stale_bsr_queue_jobs is the
-- SECOND recovery predicate that requeues failed rows. Left untouched it
-- resurrects terminal provider rejections (failed -> pending) on every
-- enqueue_chips_prefetch_gaps() call, which is exactly the loop Stage B must
-- stop. Same explicit-open rule as recover_quota_failed_bsr_jobs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recover_stale_bsr_queue_jobs(p_stale_minutes integer DEFAULT 30, p_max_attempts integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_running int := 0; v_retry int := 0;
BEGIN
  WITH r AS (
    UPDATE public.tw_bsr_sync_queue q
       SET status = 'pending', next_run_at = now()
     WHERE q.status = 'running'
       AND q.started_at IS NOT NULL
       AND q.started_at < now() - make_interval(mins => p_stale_minutes)
    RETURNING 1
  ) SELECT count(*) INTO v_running FROM r;

  WITH f AS (
    UPDATE public.tw_bsr_sync_queue q
       SET status = 'pending',
           next_run_at = now() + make_interval(mins => LEAST(60, GREATEST(1, q.attempts) * 5))
     WHERE q.status IN ('failed','skipped')
       AND q.attempts < LEAST(q.max_attempts, p_max_attempts)
       AND (q.last_error IS DISTINCT FROM 'finmind_admission_provider_plan_rejected'
            OR private_bsr.gate_explicit_open())
       AND EXISTS (
         SELECT 1 FROM public.checkup_prefetch_universe() u
          WHERE u.code = q.stock_id AND u.supported
       )
    RETURNING 1
  ) SELECT count(*) INTO v_retry FROM f;

  RETURN jsonb_build_object('running_reset', v_running, 'retry_requeued', v_retry);
END; $function$;
