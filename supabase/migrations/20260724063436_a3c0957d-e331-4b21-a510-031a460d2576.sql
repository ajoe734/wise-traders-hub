
-- ============================================================
-- M1 + M2 + fire drill: deterministic converge & on-demand ensure_bsr_window
-- ============================================================

-- ---------- M1: converge_bsr_windows 決定性重寫 ----------
CREATE OR REPLACE FUNCTION public.converge_bsr_windows(
  p_max_stocks int DEFAULT 500,
  p_chunk_dates int DEFAULT 15,
  p_horizon_days int DEFAULT 110
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_stock text;
  v_readiness jsonb;
  v_stocks_scanned int := 0;
  v_stocks_converged int := 0;
  v_stocks_exhausted int := 0;
  v_stocks_ready int := 0;
  v_stocks_total int := 0;
  v_jobs_created int := 0;
  v_d date;
  v_added int;
  v_valid_dates date[];
  v_valid_days int;
BEGIN
  -- 決定性排序：最缺的股票（valid_days 越少、last_valid 越舊）優先
  FOR v_stock, v_valid_days IN
    WITH t AS (
      SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
        FROM public.trade_records
       WHERE UPPER(COALESCE(market, 'TW')) IN ('TW','TWSE','TPEX','')
         AND instrument ~ '^[1-9][0-9]{3}'
    ),
    c AS (
      SELECT DISTINCT h->>'symbol' AS sid
        FROM public.checkup_storage cs,
             LATERAL jsonb_array_elements(COALESCE(cs.data->'holdings','[]'::jsonb)) h
       WHERE cs.key IN ('portfolio','holdings','state')
    ),
    all_stocks AS (
      SELECT sid FROM t WHERE sid ~ '^[1-9][0-9]{3}$'
      UNION
      SELECT sid FROM c WHERE sid ~ '^[1-9][0-9]{3}$'
    ),
    coverage AS (
      SELECT s.sid,
             COALESCE(
               (SELECT COUNT(*)::int
                  FROM (
                    SELECT trade_date
                      FROM public.tw_bsr_daily
                     WHERE stock_id = s.sid
                       AND trade_date >= v_today - 90
                     GROUP BY trade_date
                    HAVING COUNT(DISTINCT broker_id) >= 5
                  ) x
               ), 0) AS valid_days,
             (SELECT MAX(trade_date)
                FROM public.tw_bsr_daily d
               WHERE d.stock_id = s.sid) AS last_valid
        FROM all_stocks s
    )
    SELECT sid, valid_days
      FROM coverage
     ORDER BY valid_days ASC, last_valid ASC NULLS FIRST, sid
     LIMIT p_max_stocks
  LOOP
    v_stocks_total := v_stocks_total + 1;

    -- 只處理合格個股（跳過權證/ETF）
    IF NOT COALESCE((public.tw_bsr_eligibility(v_stock)->>'eligible')::boolean, false) THEN
      CONTINUE;
    END IF;
    v_stocks_scanned := v_stocks_scanned + 1;

    v_readiness := public.compute_bsr_series_readiness(v_stock);

    IF COALESCE((v_readiness->>'ready60')::boolean, false) THEN
      v_stocks_ready := v_stocks_ready + 1;
      CONTINUE;
    END IF;

    IF COALESCE((v_readiness->>'exhausted')::boolean, false) THEN
      v_stocks_exhausted := v_stocks_exhausted + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[])
      INTO v_valid_dates
      FROM (
        SELECT trade_date
          FROM public.tw_bsr_daily
         WHERE stock_id = v_stock
         GROUP BY trade_date
        HAVING COUNT(DISTINCT broker_id) >= 5
      ) x;

    v_d := v_today;
    v_added := 0;
    WHILE v_added < p_chunk_dates AND v_d > v_today - p_horizon_days LOOP
      IF EXTRACT(ISODOW FROM v_d) < 6 AND NOT (v_d = ANY(v_valid_dates)) THEN
        BEGIN
          INSERT INTO public.tw_bsr_sync_queue
            (stock_id, trade_date, priority, status, next_run_at,
             enqueued_by, correlation_id, post_close_only)
          VALUES
            (v_stock, v_d,
             CASE WHEN v_d = v_today THEN 1 ELSE 2 END,
             'pending', now(),
             'converge_bsr_windows',
             gen_random_uuid(),
             false)
          ON CONFLICT DO NOTHING;
          IF FOUND THEN
            v_jobs_created := v_jobs_created + 1;
            v_added := v_added + 1;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
      v_d := v_d - 1;
    END LOOP;

    IF v_added > 0 THEN
      v_stocks_converged := v_stocks_converged + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'stocks_total', v_stocks_total,
    'stocks_scanned', v_stocks_scanned,
    'stocks_ready', v_stocks_ready,
    'stocks_exhausted', v_stocks_exhausted,
    'stocks_converged', v_stocks_converged,
    'jobs_created', v_jobs_created,
    'deterministic_order', true,
    'params', jsonb_build_object(
      'max_stocks', p_max_stocks,
      'chunk_dates', p_chunk_dates,
      'horizon_days', p_horizon_days
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.converge_bsr_windows(int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.converge_bsr_windows(int, int, int) TO service_role;

-- ---------- M2: ensure_bsr_window on-demand ----------
CREATE OR REPLACE FUNCTION public.ensure_bsr_window(
  p_stock_id text,
  p_window_days int DEFAULT 5,
  p_horizon_days int DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_valid_dates date[];
  v_queued_pending text[] := ARRAY[]::text[];
  v_existing text[] := ARRAY[]::text[];
  v_newly_queued text[] := ARRAY[]::text[];
  v_d date;
  v_added int := 0;
  v_target int;
  v_probe_exhausted boolean := false;
BEGIN
  IF p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_stock_id', 'stock_id', p_stock_id);
  END IF;

  IF NOT COALESCE((public.tw_bsr_eligibility(p_stock_id)->>'eligible')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ineligible', 'stock_id', p_stock_id);
  END IF;

  SELECT COALESCE(exhausted, false) INTO v_probe_exhausted
    FROM public.tw_bsr_upstream_probe WHERE stock_id = p_stock_id;

  v_target := GREATEST(1, LEAST(60, p_window_days));

  SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[])
    INTO v_valid_dates
    FROM (
      SELECT trade_date
        FROM public.tw_bsr_daily
       WHERE stock_id = p_stock_id
       GROUP BY trade_date
      HAVING COUNT(DISTINCT broker_id) >= 5
    ) x;

  -- 已排在 queue 且尚未 done 的日期，避免重覆插入 & 用來回傳給前端
  SELECT COALESCE(array_agg(trade_date::text ORDER BY trade_date DESC), ARRAY[]::text[])
    INTO v_queued_pending
    FROM public.tw_bsr_sync_queue
   WHERE stock_id = p_stock_id
     AND status IN ('pending','running')
     AND trade_date >= v_today - p_horizon_days;

  -- 從今天往前，補到目標視窗
  v_d := v_today;
  WHILE v_added < v_target AND v_d > v_today - p_horizon_days LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      IF v_d = ANY(v_valid_dates) THEN
        v_existing := array_append(v_existing, v_d::text);
        v_added := v_added + 1;
      ELSE
        BEGIN
          INSERT INTO public.tw_bsr_sync_queue
            (stock_id, trade_date, priority, status, next_run_at,
             enqueued_by, correlation_id, post_close_only)
          VALUES
            (p_stock_id, v_d,
             1,             -- 使用者當下需要 → 最高優先
             'pending', now(),
             'ensure_bsr_window',
             gen_random_uuid(),
             false)
          ON CONFLICT (stock_id, trade_date) DO UPDATE
            SET priority   = LEAST(public.tw_bsr_sync_queue.priority, 1),
                status     = CASE WHEN public.tw_bsr_sync_queue.status IN ('failed','skipped','dead')
                                  THEN 'pending' ELSE public.tw_bsr_sync_queue.status END,
                next_run_at = LEAST(COALESCE(public.tw_bsr_sync_queue.next_run_at, now()), now())
            WHERE public.tw_bsr_sync_queue.status <> 'done';
          v_newly_queued := array_append(v_newly_queued, v_d::text);
          v_added := v_added + 1;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END IF;
    v_d := v_d - 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'stock_id', p_stock_id,
    'window_days', v_target,
    'today', v_today,
    'have_valid_days', array_length(v_valid_dates, 1),
    'existing_in_window', v_existing,
    'newly_queued', v_newly_queued,
    'already_pending', v_queued_pending,
    'upstream_exhausted', v_probe_exhausted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_bsr_window(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_bsr_window(text, int, int) TO authenticated, service_role;

-- ---------- Fire drill：全域一次性補齊近 5 日 ----------
DO $$
DECLARE
  r record;
  v_result jsonb;
  v_total int := 0;
  v_queued int := 0;
BEGIN
  FOR r IN
    WITH t AS (
      SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
        FROM public.trade_records
       WHERE UPPER(COALESCE(market, 'TW')) IN ('TW','TWSE','TPEX','')
         AND instrument ~ '^[1-9][0-9]{3}'
    ),
    c AS (
      SELECT DISTINCT h->>'symbol' AS sid
        FROM public.checkup_storage cs,
             LATERAL jsonb_array_elements(COALESCE(cs.data->'holdings','[]'::jsonb)) h
       WHERE cs.key IN ('portfolio','holdings','state')
    )
    SELECT DISTINCT sid FROM (
      SELECT sid FROM t WHERE sid ~ '^[1-9][0-9]{3}$'
      UNION
      SELECT sid FROM c WHERE sid ~ '^[1-9][0-9]{3}$'
    ) u
  LOOP
    v_total := v_total + 1;
    v_result := public.ensure_bsr_window(r.sid, 5, 10);
    IF COALESCE(jsonb_array_length(v_result->'newly_queued'), 0) > 0 THEN
      v_queued := v_queued + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'fire_drill: scanned=% queued_new=%', v_total, v_queued;
END $$;
