-- ============================================================
-- Build 1: quota 轉移正確性 + bounded recovery + backpressure
-- 不新增 table、不 mass reset。
-- ============================================================

-- 1) quota 拒絕的原子轉移：pending + 延後 + attempts 抵銷（防負值）
CREATE OR REPLACE FUNCTION public.defer_bsr_job_quota(
  p_job_id bigint,
  p_delay_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delay int := GREATEST(1, LEAST(240, COALESCE(p_delay_minutes, 30)));
  v_row public.tw_bsr_sync_queue;
BEGIN
  UPDATE public.tw_bsr_sync_queue q
     SET status       = 'pending',
         attempts     = GREATEST(q.attempts - 1, 0),  -- 抵銷 claim 時的 +1
         started_at   = NULL,
         finished_at  = NULL,
         last_error   = 'quota_deferred',
         next_run_at  = now() + make_interval(mins => v_delay),
         updated_at   = now()
   WHERE q.id = p_job_id
     AND q.status = 'running'
  RETURNING q.* INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deferred', false, 'reason', 'not_running', 'job_id', p_job_id);
  END IF;

  RETURN jsonb_build_object(
    'deferred', true,
    'job_id', v_row.id,
    'attempts', v_row.attempts,
    'next_run_at', v_row.next_run_at
  );
END;
$$;

-- 2) bounded recovery：只復活 quota 類 failed，硬 cap，且以 max_attempts 作為
--    可審計的 retry token（每筆一生最多 3 次：5 -> 6 -> 7 -> 8 停止）
CREATE OR REPLACE FUNCTION public.recover_quota_failed_bsr_jobs(
  p_max integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cap int := GREATEST(0, COALESCE(p_max, 0));
  v_recovered int := 0;
  v_remaining int := 0;
BEGIN
  IF v_cap = 0 THEN
    SELECT count(*) INTO v_remaining
      FROM public.tw_bsr_sync_queue
     WHERE status = 'failed'
       AND (last_error LIKE 'finmind_admission_%' OR last_error = 'quota_deferred')
       AND max_attempts < 8;
    RETURN jsonb_build_object('recovered', 0, 'remaining', v_remaining, 'skipped_reason', 'cap_zero');
  END IF;

  WITH picked AS (
    SELECT id
      FROM public.tw_bsr_sync_queue
     WHERE status = 'failed'
       AND (last_error LIKE 'finmind_admission_%' OR last_error = 'quota_deferred')
       AND max_attempts < 8
     ORDER BY trade_date DESC, priority ASC, stock_id ASC
     FOR UPDATE SKIP LOCKED
     LIMIT v_cap
  )
  UPDATE public.tw_bsr_sync_queue q
     SET status       = 'pending',
         max_attempts = q.max_attempts + 1,   -- 單次 retry token（可審計、有上限）
         next_run_at  = now(),
         started_at   = NULL,
         finished_at  = NULL,
         last_error   = 'quota_recovery_token',
         updated_at   = now()
    FROM picked
   WHERE q.id = picked.id;

  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  SELECT count(*) INTO v_remaining
    FROM public.tw_bsr_sync_queue
   WHERE status = 'failed'
     AND (last_error LIKE 'finmind_admission_%' OR last_error = 'quota_deferred')
     AND max_attempts < 8;

  RETURN jsonb_build_object('recovered', v_recovered, 'remaining', v_remaining, 'cap', v_cap);
END;
$$;

-- 3) backpressure 評估（唯讀），供 enqueue 決定 recovery budget
CREATE OR REPLACE FUNCTION public.bsr_recovery_budget(p_full_budget integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pending int;
  v_oldest_age_hours numeric;
  v_degrade text;
  v_ks boolean;
  v_quota_ratio numeric;
  v_level text;
  v_budget int;
BEGIN
  SELECT count(*),
         COALESCE(EXTRACT(epoch FROM (now() - min(next_run_at))) / 3600.0, 0)
    INTO v_pending, v_oldest_age_hours
    FROM public.tw_bsr_sync_queue
   WHERE status = 'pending' AND next_run_at <= now();

  SELECT mode INTO v_degrade FROM public.bsr_get_degrade_state('finmind');
  SELECT public.check_kill_switch('chips_all') INTO v_ks;

  SELECT COALESCE(max(used_today::numeric / NULLIF(daily_budget, 0)), 0)
    INTO v_quota_ratio
    FROM public.finmind_quota_pools
   WHERE pool_name = 'keepwarm';

  IF v_ks IS NOT TRUE OR COALESCE(v_degrade, 'normal') <> 'normal' THEN
    v_level := 'halted'; v_budget := 0;
  ELSIF v_pending > 600 OR v_oldest_age_hours > 12 OR v_quota_ratio >= 0.8 THEN
    v_level := 'hard_stop'; v_budget := 0;
  ELSIF v_oldest_age_hours >= 2 THEN
    v_level := 'micro'; v_budget := LEAST(4, GREATEST(0, COALESCE(p_full_budget, 12)));
  ELSE
    v_level := 'full'; v_budget := GREATEST(0, COALESCE(p_full_budget, 12));
  END IF;

  RETURN jsonb_build_object(
    'level', v_level,
    'budget', v_budget,
    'pending_ready', v_pending,
    'oldest_ready_age_hours', round(v_oldest_age_hours, 2),
    'degrade_mode', v_degrade,
    'kill_switch_on', v_ks,
    'keepwarm_quota_ratio', round(v_quota_ratio, 3)
  );
END;
$$;

-- 4) 每小時 enqueue：維持既有持股 gap 行為，新增 backpressure + bounded recovery
CREATE OR REPLACE FUNCTION public.enqueue_chips_prefetch_gaps(
  p_lookback_days integer DEFAULT 10,
  p_max_stocks integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tpe_now timestamp := (now() AT TIME ZONE 'Asia/Taipei');
  v_today date := v_tpe_now::date;
  v_end date;
  v_inserted int := 0;
  v_row_ct int;
  v_gaps int := 0;
  g record;
  d date;
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
    FOR d IN
      SELECT td FROM public.tw_trading_days(v_end - (p_lookback_days - 1), v_end) td
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.tw_bsr_daily bd
         WHERE bd.stock_id = g.stock_id AND bd.trade_date = d
      ) THEN
        INSERT INTO public.tw_bsr_sync_queue
          (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
        VALUES (g.stock_id, d, CASE WHEN d = v_end THEN 1 ELSE 2 END,
                'pending', now(), 'chips_prefetch_hourly', gen_random_uuid(), false)
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_row_ct = ROW_COUNT;
        v_inserted := v_inserted + v_row_ct;
      END IF;
    END LOOP;
  END LOOP;

  v_recover := public.recover_stale_bsr_queue_jobs();

  -- Build 1：quota-failed 的漸進回收，受 backpressure 硬 cap 控制
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
$$;

REVOKE ALL ON FUNCTION public.defer_bsr_job_quota(bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bsr_recovery_budget(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.defer_bsr_job_quota(bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bsr_recovery_budget(integer) TO service_role;