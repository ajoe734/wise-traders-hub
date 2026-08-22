-- ==== enqueue_all_active_tw_holdings_bsr(integer) | oid=62956 | prosecdef=t | provolatile=v | proconfig={search_path=public} | owner=postgres | acl={postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}
CREATE OR REPLACE FUNCTION public.enqueue_all_active_tw_holdings_bsr(p_lookback_days integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_stock text;
  v_d date;
  v_days_added int;
  v_scanned int := 0;
  v_eligible int := 0;
  v_inserted int := 0;
  v_row_ct int;
BEGIN
  FOR v_stock, v_scanned IN
    SELECT u.code, 0 FROM public.checkup_prefetch_universe() u WHERE u.supported
  LOOP
    v_eligible := v_eligible + 1;
    v_d := v_today; v_days_added := 0;
    WHILE v_days_added < p_lookback_days LOOP
      IF EXTRACT(ISODOW FROM v_d) < 6 THEN
        INSERT INTO public.tw_bsr_sync_queue
          (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
        VALUES (v_stock, v_d, CASE WHEN v_d = v_today THEN 1 ELSE 2 END,
                'pending', now(), 'enqueue_all_active_holdings', gen_random_uuid(), false)
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_row_ct = ROW_COUNT;
        v_inserted := v_inserted + v_row_ct;
        v_days_added := v_days_added + 1;
      END IF;
      v_d := v_d - 1;
      EXIT WHEN v_d < v_today - 30;
    END LOOP;
  END LOOP;

  SELECT count(*) INTO v_scanned FROM public.checkup_prefetch_universe();

  RETURN jsonb_build_object(
    'stocks_scanned', v_scanned,
    'stocks_eligible', v_eligible,
    'inserted', v_inserted,
    'lookback_days', p_lookback_days
  );
END; $function$
;

-- ==== enqueue_bsr_backfill(text,integer) | oid=61290 | prosecdef=t | provolatile=v | proconfig={search_path=public} | owner=postgres | acl={postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}
CREATE OR REPLACE FUNCTION public.enqueue_bsr_backfill(p_stock_id text, p_days integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_d date;
  v_inserted int := 0;
  v_count int := 0;
  v_row_ct int;
  v_max_days int := LEAST(GREATEST(p_days, 1), 120);
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RAISE EXCEPTION 'invalid stock_id (must be 4-digit code starting 1-9)';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT public.has_role(v_uid, 'company_admin') INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE (regexp_match(COALESCE(tr.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] = p_stock_id
        AND e.user_id = v_uid
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      -- 只看「自己」的持倉列；解析 array 與 {holdings:[]} 兩種形狀
      SELECT EXISTS (
        SELECT 1
          FROM public.checkup_storage cs,
               LATERAL jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
                   WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
                   ELSE '[]'::jsonb
                 END
               ) h
         WHERE cs.user_id = v_uid
           AND cs.key LIKE 'pf-holdings%'
           AND upper(btrim(COALESCE(h->>'code', h->>'symbol'))) = p_stock_id
      ) INTO v_is_owner;
    END IF;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'not authorized to backfill this stock';
    END IF;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < v_max_days LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES (p_stock_id, v_d, 1, 'pending', now(), 'backfill_rpc', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_row_ct = ROW_COUNT;
      v_inserted := v_inserted + v_row_ct;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 200;
  END LOOP;

  RETURN v_inserted;
END; $function$
;

-- ==== enqueue_bsr_first_fetch_on_trade() | oid=61031 | prosecdef=t | provolatile=v | proconfig={search_path=public} | owner=postgres | acl={=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}
CREATE OR REPLACE FUNCTION public.enqueue_bsr_first_fetch_on_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock text;
  v_market text := UPPER(COALESCE(NEW.market, ''));
  v_d date;
  v_count int := 0;
BEGIN
  IF v_market NOT IN ('TW', 'TWSE', 'TPEX', '') THEN RETURN NEW; END IF;

  v_stock := (regexp_match(COALESCE(NEW.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1];
  IF v_stock IS NULL THEN RETURN NEW; END IF;

  IF (SELECT count(*) FROM public.tw_bsr_daily WHERE stock_id = v_stock) >= 20 THEN
    RETURN NEW;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < 60 LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES
        (v_stock, v_d, 1, 'pending', now(), 'trade_insert_hook_backfill', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 150;
  END LOOP;

  RETURN NEW;
END; $function$
;

-- ==== enqueue_chips_prefetch_gaps(integer,integer) | oid=79419 | prosecdef=t | provolatile=v | proconfig={search_path=public} | owner=postgres | acl={postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}
CREATE OR REPLACE FUNCTION public.enqueue_chips_prefetch_gaps(p_lookback_days integer DEFAULT 10, p_max_stocks integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tpe_now timestamp := (now() AT TIME ZONE 'Asia/Taipei');
  v_today date := v_tpe_now::date;
  v_end date;
  v_inserted int := 0;
  v_row_ct int;
  v_gaps int := 0;
  g record;
  d date;
  v_rank int;
  v_recover jsonb;
  v_bp jsonb;
  v_quota_recover jsonb;
BEGIN
  v_end := CASE WHEN v_tpe_now::time >= time '15:00' THEN v_today ELSE v_today - 1 END;
  SELECT max(td) INTO v_end FROM public.tw_trading_days(v_end - 10, v_end) td;
  IF v_end IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no_trading_day');
  END IF;

  FOR g IN
    SELECT * FROM public.detect_chip_gap_jobs(v_end, p_lookback_days, p_max_stocks)
  LOOP
    v_gaps := v_gaps + 1;

    SELECT CASE
             WHEN 'checkup_storage' = ANY(u.sources) THEN 1
             WHEN 'trade_records' = ANY(u.sources) AND EXISTS (
               SELECT 1 FROM public.trade_records tr
                WHERE tr.status = 'open'
                  AND COALESCE(upper(tr.market),'TW') IN ('TW','TWSE','TPEX','')
                  AND upper(btrim((regexp_match(split_part(tr.instrument,' ',1), '^([0-9A-Z]{4,6})'))[1])) = g.stock_id
             ) THEN 2
             ELSE 3
           END
      INTO v_rank
      FROM public.checkup_prefetch_universe() u
     WHERE u.code = g.stock_id
     LIMIT 1;

    v_rank := COALESCE(v_rank, 3);

    FOR d IN
      SELECT td FROM public.tw_trading_days(v_end - (p_lookback_days - 1), v_end) td
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.tw_bsr_daily bd
         WHERE bd.stock_id = g.stock_id AND bd.trade_date = d
      ) THEN
        INSERT INTO public.tw_bsr_sync_queue
          (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
        VALUES (g.stock_id, d, v_rank,
                'pending', now(), 'chips_prefetch_hourly:r' || v_rank, gen_random_uuid(), false)
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_row_ct = ROW_COUNT;
        v_inserted := v_inserted + v_row_ct;
      END IF;
    END LOOP;
  END LOOP;

  v_recover := public.recover_stale_bsr_queue_jobs();

  v_bp := public.bsr_recovery_budget(12);
  v_quota_recover := public.recover_quota_failed_bsr_jobs((v_bp->>'budget')::int);

  RETURN jsonb_build_object(
    'target_date', v_end,
    'lookback_days', p_lookback_days,
    'stocks_with_gaps', v_gaps,
    'inserted', v_inserted,
    'recovery', v_recover,
    'backpressure', v_bp,
    'quota_recovery', v_quota_recover
  );
END;
$function$
;

-- ==== ensure_bsr_queued(text) | oid=62720 | prosecdef=t | provolatile=v | proconfig={search_path=public} | owner=postgres | acl={=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}
CREATE OR REPLACE FUNCTION public.ensure_bsr_queued(p_stock_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_elig jsonb;
  v_today date;
  v_active record;
  v_done record;
  v_failure record;
  v_next timestamptz := now();
  v_reason text;
  v_inserted integer := 0;
  v_raw_rows integer := 0;
  v_done_threshold integer := 5;
  v_fake_done boolean := false;
BEGIN
  v_elig := public.tw_bsr_eligibility(p_stock_id);
  IF COALESCE((v_elig->>'eligible')::boolean, false) = false THEN
    RETURN v_elig || jsonb_build_object('created', false, 'status', 'ineligible');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bsr_queue:' || p_stock_id));

  v_today := (now() AT TIME ZONE 'Asia/Taipei')::date;

  -- 已有 active job → no-op
  SELECT status, trade_date, next_run_at INTO v_active
    FROM public.tw_bsr_sync_queue
    WHERE stock_id = p_stock_id AND status IN ('pending','running')
    ORDER BY updated_at DESC
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'eligible', true,
      'created', false,
      'status', v_active.status,
      'trade_date', v_active.trade_date,
      'next_run_at', v_active.next_run_at
    );
  END IF;

  -- 今日已 done 必須同時有足夠 raw broker rows，否則視為 fake_done，允許重新排隊。
  SELECT trade_date, updated_at INTO v_done
    FROM public.tw_bsr_sync_queue
    WHERE stock_id = p_stock_id AND trade_date = v_today AND status = 'done'
    ORDER BY updated_at DESC
    LIMIT 1;
  IF FOUND THEN
    SELECT count(*) INTO v_raw_rows
      FROM public.tw_bsr_daily
      WHERE stock_id = p_stock_id AND trade_date = v_today;

    IF v_raw_rows >= v_done_threshold THEN
      RETURN jsonb_build_object(
        'eligible', true,
        'created', false,
        'status', 'completed',
        'trade_date', v_done.trade_date,
        'completed_at', v_done.updated_at,
        'raw_rows', v_raw_rows
      );
    END IF;

    v_fake_done := true;
  END IF;

  -- 尊重 fetch_failures 冷卻
  SELECT next_retry_at, reason INTO v_failure
    FROM public.tw_bsr_fetch_failures
    WHERE stock_id = p_stock_id AND resolved_at IS NULL
    ORDER BY trade_date DESC
    LIMIT 1;
  IF FOUND AND v_failure.next_retry_at IS NOT NULL AND v_failure.next_retry_at > now() THEN
    v_next := v_failure.next_retry_at;
    v_reason := v_failure.reason;
  END IF;

  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
  VALUES
    (p_stock_id, v_today, 1, 'pending', v_next, 'ensure_bsr_queued', gen_random_uuid(), false)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'eligible', true,
    'created', v_inserted > 0,
    'status', 'pending',
    'trade_date', v_today,
    'next_run_at', v_next,
    'respected_backoff_reason', v_reason,
    'requeued_fake_done', v_fake_done,
    'raw_rows', v_raw_rows,
    'required_raw_rows', v_done_threshold
  );
END;
$function$
;

-- ==== recover_quota_failed_bsr_jobs(integer) | oid=81204 | prosecdef=t | provolatile=v | proconfig={search_path=public} | owner=postgres | acl={postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}
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
$function$
;

-- ==== recover_stale_bsr_queue_jobs(integer,integer) | oid=79418 | prosecdef=t | provolatile=v | proconfig={search_path=public} | owner=postgres | acl={postgres=X/postgres,service_role=X/postgres,sandbox_exec_yqacmrgdjlenbijclngi=X/postgres}
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
       AND EXISTS (
         SELECT 1 FROM public.checkup_prefetch_universe() u
          WHERE u.code = q.stock_id AND u.supported
       )
    RETURNING 1
  ) SELECT count(*) INTO v_retry FROM f;

  RETURN jsonb_build_object('running_reset', v_running, 'retry_requeued', v_retry);
END; $function$
;
