-- M4：分點有效門檻 5 → 1（有一筆分點即視為 valid，<5 由前端加「低品質」標記）
-- 需同步更新：
--   1) compute_bsr_series_readiness — 判定 5/20/60 日視窗是否 ready
--   2) converge_bsr_windows — 收斂排程用來收集「已 valid」日期集合

CREATE OR REPLACE FUNCTION public.compute_bsr_series_readiness(p_stock_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold int := 1;            -- M4：由 5 降至 1，對齊 bsrRollup.DONE_BROKER_THRESHOLD
  v_low_quality int := 5;          -- 對齊 bsrRollup.LOW_QUALITY_BROKER_THRESHOLD
  v_have5 int;
  v_have20 int;
  v_have60 int;
  v_have5_lowq int;
  v_have20_lowq int;
  v_have60_lowq int;
  v_earliest date;
  v_latest date;
  v_probe record;
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RETURN jsonb_build_object('error', 'invalid_stock_id');
  END IF;

  WITH per_day AS (
    SELECT trade_date, COUNT(DISTINCT broker_id) AS broker_count
      FROM public.tw_bsr_daily
     WHERE stock_id = p_stock_id
     GROUP BY trade_date
  ),
  valid_days AS (
    SELECT trade_date, broker_count
      FROM per_day
     WHERE broker_count >= v_threshold
  ),
  windowed AS (
    SELECT
      trade_date,
      broker_count,
      trade_date >= v_today - INTERVAL '10 days'   AS in5,
      trade_date >= v_today - INTERVAL '40 days'   AS in20,
      trade_date >= v_today - INTERVAL '110 days'  AS in60
      FROM valid_days
  )
  SELECT
    COUNT(*) FILTER (WHERE in5),
    COUNT(*) FILTER (WHERE in20),
    COUNT(*) FILTER (WHERE in60),
    COUNT(*) FILTER (WHERE in5  AND broker_count < v_low_quality),
    COUNT(*) FILTER (WHERE in20 AND broker_count < v_low_quality),
    COUNT(*) FILTER (WHERE in60 AND broker_count < v_low_quality),
    MIN(trade_date),
    MAX(trade_date)
  INTO v_have5, v_have20, v_have60,
       v_have5_lowq, v_have20_lowq, v_have60_lowq,
       v_earliest, v_latest
  FROM windowed;

  SELECT * INTO v_probe FROM public.tw_bsr_upstream_probe WHERE stock_id = p_stock_id;

  RETURN jsonb_build_object(
    'stock_id', p_stock_id,
    'today', v_today,
    'threshold', v_threshold,
    'low_quality_threshold', v_low_quality,
    'have5',  COALESCE(v_have5, 0),
    'have20', COALESCE(v_have20, 0),
    'have60', COALESCE(v_have60, 0),
    'have5_low_quality',  COALESCE(v_have5_lowq, 0),
    'have20_low_quality', COALESCE(v_have20_lowq, 0),
    'have60_low_quality', COALESCE(v_have60_lowq, 0),
    'earliest_available', v_earliest,
    'latest_available',   v_latest,
    'exhausted', COALESCE(v_probe.exhausted, false),
    'probed_back_to', v_probe.probed_back_to,
    'ready5',  COALESCE(v_have5, 0)  >= 5,
    'ready20', COALESCE(v_have20, 0) >= 20,
    'ready60', COALESCE(v_have60, 0) >= 60
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_bsr_series_readiness(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bsr_series_readiness(text) TO authenticated, service_role;

-- 收斂排程：同步將 HAVING >= 5 改為 >= 1
CREATE OR REPLACE FUNCTION public.converge_bsr_windows(
  p_max_stocks int DEFAULT 40,
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
  v_stocks text[];
  v_stock text;
  v_readiness jsonb;
  v_stocks_scanned int := 0;
  v_stocks_converged int := 0;
  v_stocks_exhausted int := 0;
  v_stocks_ready int := 0;
  v_jobs_created int := 0;
  v_d date;
  v_added int;
  v_valid_dates date[];
BEGIN
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
  SELECT array_agg(DISTINCT sid) INTO v_stocks
    FROM (SELECT sid FROM t WHERE sid IS NOT NULL
          UNION
          SELECT sid FROM c WHERE sid ~ '^[1-9][0-9]{3}$') u
   WHERE sid ~ '^[1-9][0-9]{3}$';

  IF v_stocks IS NULL THEN
    RETURN jsonb_build_object('stocks', 0, 'jobs_created', 0);
  END IF;

  FOREACH v_stock IN ARRAY v_stocks LOOP
    EXIT WHEN v_stocks_scanned >= p_max_stocks;

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

    -- M4：已有的 valid 日期 = 該日 broker 列數 >= 1（過去為 >= 5）
    SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[])
      INTO v_valid_dates
      FROM (
        SELECT trade_date
          FROM public.tw_bsr_daily
         WHERE stock_id = v_stock
         GROUP BY trade_date
        HAVING COUNT(DISTINCT broker_id) >= 1
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
    'stocks_total', array_length(v_stocks, 1),
    'stocks_scanned', v_stocks_scanned,
    'stocks_ready', v_stocks_ready,
    'stocks_exhausted', v_stocks_exhausted,
    'stocks_converged', v_stocks_converged,
    'jobs_created', v_jobs_created,
    'params', jsonb_build_object(
      'max_stocks', p_max_stocks,
      'chunk_dates', p_chunk_dates,
      'horizon_days', p_horizon_days,
      'threshold', 1
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.converge_bsr_windows(int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.converge_bsr_windows(int, int, int) TO service_role;