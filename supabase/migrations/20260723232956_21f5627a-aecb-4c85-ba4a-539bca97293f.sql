
-- ============================================================
-- BSR 視窗收斂排程（M2）
-- 目標：每檔 active TW 持倉的 5/20/60 日視窗達到 ready 或 upstream_exhausted
-- ============================================================

-- 1) 上游窮竭探測表
CREATE TABLE IF NOT EXISTS public.tw_bsr_upstream_probe (
  stock_id text PRIMARY KEY,
  earliest_data date,           -- tw_bsr_daily 中最早的有效日期
  probed_back_to date,          -- 已往前探測到的最早日期（含空回應）
  empty_streak int NOT NULL DEFAULT 0,  -- 連續空回應天數
  exhausted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tw_bsr_upstream_probe TO authenticated;
GRANT ALL ON public.tw_bsr_upstream_probe TO service_role;

ALTER TABLE public.tw_bsr_upstream_probe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read probe" ON public.tw_bsr_upstream_probe;
CREATE POLICY "authenticated read probe"
  ON public.tw_bsr_upstream_probe FOR SELECT TO authenticated
  USING (true);

-- 2) 讀單檔視窗完整度
CREATE OR REPLACE FUNCTION public.compute_bsr_series_readiness(p_stock_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold int := 5;   -- 與 bsrRollup.DONE_BROKER_THRESHOLD 一致
  v_have5 int;
  v_have20 int;
  v_have60 int;
  v_earliest date;
  v_latest date;
  v_probe record;
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RETURN jsonb_build_object('error', 'invalid_stock_id');
  END IF;

  -- 有效日期 = 該日在 tw_bsr_daily 內達 threshold 分點列數
  WITH valid_days AS (
    SELECT trade_date
      FROM public.tw_bsr_daily
     WHERE stock_id = p_stock_id
     GROUP BY trade_date
    HAVING COUNT(DISTINCT broker_id) >= v_threshold
  ),
  windowed AS (
    SELECT
      trade_date,
      trade_date >= v_today - INTERVAL '10 days'   AS in5,
      trade_date >= v_today - INTERVAL '40 days'   AS in20,
      trade_date >= v_today - INTERVAL '110 days'  AS in60
      FROM valid_days
  )
  SELECT
    COUNT(*) FILTER (WHERE in5),
    COUNT(*) FILTER (WHERE in20),
    COUNT(*) FILTER (WHERE in60),
    MIN(trade_date),
    MAX(trade_date)
  INTO v_have5, v_have20, v_have60, v_earliest, v_latest
  FROM windowed;

  SELECT * INTO v_probe FROM public.tw_bsr_upstream_probe WHERE stock_id = p_stock_id;

  RETURN jsonb_build_object(
    'stock_id', p_stock_id,
    'today', v_today,
    'have5',  COALESCE(v_have5, 0),
    'have20', COALESCE(v_have20, 0),
    'have60', COALESCE(v_have60, 0),
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

-- 3) 收斂排程：對所有 active TW 持倉，將缺日排入 queue
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
  v_probe record;
  v_d date;
  v_added int;
  v_valid_dates date[];
BEGIN
  -- 收集 active TW 持倉（用與 enqueue_all_active_tw_holdings_bsr 相同來源）
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

    -- 只處理合格個股（跳過權證/ETF）
    IF NOT COALESCE((public.tw_bsr_eligibility(v_stock)->>'eligible')::boolean, false) THEN
      CONTINUE;
    END IF;
    v_stocks_scanned := v_stocks_scanned + 1;

    v_readiness := public.compute_bsr_series_readiness(v_stock);

    -- 已 ready 60：跳過
    IF COALESCE((v_readiness->>'ready60')::boolean, false) THEN
      v_stocks_ready := v_stocks_ready + 1;
      CONTINUE;
    END IF;

    -- 上游窮竭：跳過（其視窗狀態由 UI 顯示 upstream_exhausted）
    IF COALESCE((v_readiness->>'exhausted')::boolean, false) THEN
      v_stocks_exhausted := v_stocks_exhausted + 1;
      CONTINUE;
    END IF;

    -- 收集該檔已有的有效日期集合
    SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[])
      INTO v_valid_dates
      FROM (
        SELECT trade_date
          FROM public.tw_bsr_daily
         WHERE stock_id = v_stock
         GROUP BY trade_date
        HAVING COUNT(DISTINCT broker_id) >= 5
      ) x;

    -- 從 today 往前，逐日補齊：不是週末、不在 valid_dates、且沒有 active job → 排入 priority=2
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
          -- 忽略 unique 衝突
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
      'horizon_days', p_horizon_days
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.converge_bsr_windows(int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.converge_bsr_windows(int, int, int) TO service_role;

-- 4) 上游窮竭標記工具（給 worker 用）
CREATE OR REPLACE FUNCTION public.mark_bsr_upstream_probe(
  p_stock_id text,
  p_probed_date date,
  p_had_data boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_earliest date;
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RETURN;
  END IF;

  SELECT MIN(trade_date) INTO v_earliest
    FROM public.tw_bsr_daily WHERE stock_id = p_stock_id;

  INSERT INTO public.tw_bsr_upstream_probe (stock_id, earliest_data, probed_back_to, empty_streak, exhausted, updated_at)
  VALUES (
    p_stock_id, v_earliest, p_probed_date,
    CASE WHEN p_had_data THEN 0 ELSE 1 END,
    false, now()
  )
  ON CONFLICT (stock_id) DO UPDATE SET
    earliest_data = COALESCE(v_earliest, tw_bsr_upstream_probe.earliest_data),
    probed_back_to = LEAST(COALESCE(tw_bsr_upstream_probe.probed_back_to, p_probed_date), p_probed_date),
    empty_streak = CASE
      WHEN p_had_data THEN 0
      ELSE tw_bsr_upstream_probe.empty_streak + 1
    END,
    -- 連續 20 天無資料 → 判定窮竭
    exhausted = CASE
      WHEN p_had_data THEN false
      WHEN tw_bsr_upstream_probe.empty_streak + 1 >= 20 THEN true
      ELSE tw_bsr_upstream_probe.exhausted
    END,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bsr_upstream_probe(text, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bsr_upstream_probe(text, date, boolean) TO service_role;
