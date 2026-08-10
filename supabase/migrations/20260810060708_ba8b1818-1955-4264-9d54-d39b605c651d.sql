-- ============================================================
-- 1) prefetch target registry
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chips_prefetch_targets (
  code        text PRIMARY KEY,
  source      text NOT NULL DEFAULT 'manual',
  active      boolean NOT NULL DEFAULT true,
  supported   boolean NOT NULL DEFAULT true,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chips_prefetch_targets_source_chk CHECK (source IN ('demo_seed','manual','ops'))
);

GRANT SELECT ON public.chips_prefetch_targets TO authenticated;
GRANT ALL ON public.chips_prefetch_targets TO service_role;

ALTER TABLE public.chips_prefetch_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_chips_prefetch_targets" ON public.chips_prefetch_targets;
CREATE POLICY "admins_read_chips_prefetch_targets"
  ON public.chips_prefetch_targets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::public.app_role));

DROP POLICY IF EXISTS "service_role_manages_chips_prefetch_targets" ON public.chips_prefetch_targets;
CREATE POLICY "service_role_manages_chips_prefetch_targets"
  ON public.chips_prefetch_targets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.chips_prefetch_targets_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_chips_prefetch_targets_touch ON public.chips_prefetch_targets;
CREATE TRIGGER trg_chips_prefetch_targets_touch
  BEFORE UPDATE ON public.chips_prefetch_targets
  FOR EACH ROW EXECUTE FUNCTION public.chips_prefetch_targets_touch();

-- seed: demo watchlist (src/checkup/seedData.js INIT_HOLDINGS), locked by contract test
INSERT INTO public.chips_prefetch_targets (code, source, active, supported, reason)
SELECT c.code, 'demo_seed', true,
       COALESCE((public.tw_bsr_eligibility(c.code)->>'eligible')::boolean, false),
       public.tw_bsr_eligibility(c.code)->>'ineligible_reason'
FROM (VALUES
  ('00637L'),('039108'),('053848'),('702157'),('1503'),('1717'),('2308'),('2313'),
  ('2543'),('3006'),('3013'),('3017'),('3231'),('3443'),('3491'),('4583'),
  ('6274'),('6770'),('6862'),('8227')
) AS c(code)
ON CONFLICT (code) DO UPDATE
  SET source    = 'demo_seed',
      active    = true,
      supported = EXCLUDED.supported,
      reason    = EXCLUDED.reason;

-- ============================================================
-- 2) single universe
-- ============================================================
CREATE OR REPLACE FUNCTION public.checkup_prefetch_universe()
RETURNS TABLE (code text, supported boolean, reason text, sources text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH raw AS (
    SELECT upper(btrim((regexp_match(split_part(tr.instrument,' ',1), '^([0-9A-Z]{4,6})'))[1])) AS code,
           'trade_records'::text AS src
      FROM public.trade_records tr
     WHERE COALESCE(upper(tr.market),'TW') IN ('TW','TWSE','TPEX','')
       AND split_part(tr.instrument,' ',1) ~ '^[0-9]'
    UNION ALL
    SELECT upper(btrim((regexp_match(split_part(es.instrument,' ',1), '^([0-9A-Z]{4,6})'))[1])),
           'expert_signals'
      FROM public.expert_signals es
     WHERE es.published_at IS NOT NULL
       AND COALESCE(upper(es.market),'TW') IN ('TW','TWSE','TPEX','')
       AND split_part(es.instrument,' ',1) ~ '^[0-9]'
    UNION ALL
    SELECT upper(btrim(COALESCE(h->>'code', h->>'symbol'))), 'checkup_storage'
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
               WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
               ELSE '[]'::jsonb
             END
           ) h
     WHERE cs.key = 'pf-holdings-v2'
    UNION ALL
    SELECT upper(btrim(t.code)), 'registry'
      FROM public.chips_prefetch_targets t
     WHERE t.active
  ),
  norm AS (
    SELECT code, src FROM raw WHERE code IS NOT NULL AND code <> ''
  ),
  agg AS (
    SELECT code, array_agg(DISTINCT src ORDER BY src) AS sources
      FROM norm GROUP BY code
  )
  SELECT a.code,
         COALESCE((public.tw_bsr_eligibility(a.code)->>'eligible')::boolean, false) AS supported,
         public.tw_bsr_eligibility(a.code)->>'ineligible_reason' AS reason,
         a.sources
    FROM agg a;
$$;

GRANT EXECUTE ON FUNCTION public.checkup_prefetch_universe() TO service_role;

-- ============================================================
-- 3) gap detection now reads the unified universe
-- ============================================================
CREATE OR REPLACE FUNCTION public.detect_chip_gap_jobs(
  _target_date date DEFAULT CURRENT_DATE,
  _lookback_days integer DEFAULT 60,
  _max_jobs integer DEFAULT 5000
)
RETURNS TABLE (stock_id text, start_date date, end_date date, gap_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH universe AS (
    SELECT u.code AS symbol FROM public.checkup_prefetch_universe() u WHERE u.supported
  ),
  trade_dates AS (
    SELECT td AS trade_date
      FROM public.tw_trading_days(_target_date - (_lookback_days - 1), _target_date) td
  ),
  expected AS (SELECT u.symbol, td.trade_date FROM universe u CROSS JOIN trade_dates td),
  existing AS (
    SELECT DISTINCT bd.stock_id, bd.trade_date
      FROM public.tw_bsr_daily bd
     WHERE bd.trade_date BETWEEN _target_date - (_lookback_days - 1) AND _target_date
  ),
  missing AS (
    SELECT e.symbol, e.trade_date
      FROM expected e
      LEFT JOIN existing ex ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
     WHERE ex.stock_id IS NULL
  ),
  gaps AS (
    SELECT m.symbol, MIN(m.trade_date) AS min_date, MAX(m.trade_date) AS max_date, COUNT(*)::integer AS cnt
      FROM missing m GROUP BY m.symbol
  )
  SELECT g.symbol AS stock_id, g.min_date AS start_date, g.max_date AS end_date, g.cnt AS gap_count
    FROM gaps g ORDER BY g.cnt DESC LIMIT _max_jobs;
$$;

CREATE OR REPLACE FUNCTION public.detect_institutional_gap_jobs(
  _target_date date DEFAULT CURRENT_DATE,
  _lookback_days integer DEFAULT 60,
  _max_jobs integer DEFAULT 5000
)
RETURNS TABLE (stock_id text, start_date date, end_date date, gap_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH universe AS (
    SELECT u.code AS symbol FROM public.checkup_prefetch_universe() u WHERE u.supported
  ),
  trade_dates AS (
    SELECT td AS trade_date
      FROM public.tw_trading_days(_target_date - (_lookback_days - 1), _target_date) td
  ),
  expected AS (SELECT u.symbol, td.trade_date FROM universe u CROSS JOIN trade_dates td),
  existing AS (
    SELECT DISTINCT idl.stock_id, idl.trade_date
      FROM public.tw_institutional_daily idl
     WHERE idl.trade_date BETWEEN _target_date - (_lookback_days - 1) AND _target_date
  ),
  missing AS (
    SELECT e.symbol, e.trade_date
      FROM expected e
      LEFT JOIN existing ex ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
     WHERE ex.stock_id IS NULL
  ),
  gaps AS (
    SELECT m.symbol, MIN(m.trade_date) AS min_date, MAX(m.trade_date) AS max_date, COUNT(*)::integer AS cnt
      FROM missing m GROUP BY m.symbol
  )
  SELECT g.symbol AS stock_id, g.min_date AS start_date, g.max_date AS end_date, g.cnt AS gap_count
    FROM gaps g ORDER BY g.cnt DESC LIMIT _max_jobs;
$$;

-- ============================================================
-- 4) member self-service backfill: payload -> data, keep user isolation
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_bsr_backfill(p_stock_id text, p_days integer DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT public.has_role(v_uid, 'admin') INTO v_is_admin;

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
END; $$;

REVOKE ALL ON FUNCTION public.enqueue_bsr_backfill(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, integer) TO service_role;

-- ============================================================
-- 5) holdings enqueuer now uses the unified universe
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_all_active_tw_holdings_bsr(p_lookback_days integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END; $$;

-- ============================================================
-- 6) hourly gap enqueue + bounded recovery (pure SQL, no external quota)
-- ============================================================
CREATE OR REPLACE FUNCTION public.recover_stale_bsr_queue_jobs(
  p_stale_minutes integer DEFAULT 30,
  p_max_attempts integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END; $$;

CREATE OR REPLACE FUNCTION public.enqueue_chips_prefetch_gaps(
  p_lookback_days integer DEFAULT 10,
  p_max_stocks integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  -- 收盤後（台北 15:00）才把今天算進期望值，否則以昨天為界
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

  RETURN jsonb_build_object(
    'target_date', v_end,
    'lookback_days', p_lookback_days,
    'stocks_with_gaps', v_gaps,
    'inserted', v_inserted,
    'recovery', v_recover
  );
END; $$;

-- ============================================================
-- 7) schedules
-- ============================================================
DO $$
BEGIN
  PERFORM cron.unschedule('chips-prefetch-enqueue-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'chips-prefetch-enqueue-hourly',
  '2 * * * *',
  $$SELECT public.enqueue_chips_prefetch_gaps(10, 300);$$
);

DO $$
BEGIN
  PERFORM cron.unschedule('tw-bsr-worker-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'tw-bsr-worker-hourly',
  '7 0-12 * * *',
  $$SELECT public.cron_edge_call('tw-bsr-finmind-sync', '{"mode": "worker", "batch": 30, "budget_ms": 45000, "max_priority": 3, "ignore_window": true}'::jsonb, 120000);$$
);
