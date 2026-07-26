
-- =========================================================================
-- P2.1: source column on tw_institutional_daily
-- =========================================================================
ALTER TABLE public.tw_institutional_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN public.tw_institutional_daily.source IS
  'Ingestion lane label: twse_bfi82u | tpex_bulk | t86 | unknown (legacy)';

CREATE INDEX IF NOT EXISTS idx_tw_institutional_daily_date_source
  ON public.tw_institutional_daily(trade_date, source);

-- =========================================================================
-- P2.2: reconcile_snapshot — independent per-lane sealing
-- =========================================================================
-- Thresholds are tunable via GUC-like reads later; hard-coded for P2.
CREATE OR REPLACE FUNCTION public.reconcile_snapshot(_trade_date date)
RETURNS TABLE (
  trade_date date,
  lane_a_status text,
  lane_b_status text,
  lane_c_status text,
  sealed_at timestamptz,
  sealed_by_lane text,
  coverage_stocks integer,
  coverage_brokers integer,
  bsr_stocks integer,
  inst_stocks integer,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- BSR (Lane A) thresholds
  v_bsr_min_stocks constant int := 500;
  v_bsr_min_brokers_per_stock constant int := 5;

  -- Institutional (Lane B/C/D) thresholds
  v_inst_min_stocks constant int := 800;

  v_bsr_stocks int := 0;
  v_bsr_broker_rows int := 0;
  v_bsr_stocks_with_min int := 0;

  v_inst_stocks int := 0;
  v_inst_twse int := 0;
  v_inst_tpex int := 0;
  v_inst_t86 int := 0;

  v_lane_a text := 'pending';
  v_lane_b text := 'pending';
  v_lane_c text := 'pending';
  v_sealed_at timestamptz := NULL;
  v_sealed_by_lane text := NULL;
  v_notes text := '';
BEGIN
  -- ---- Lane A: BSR coverage ----
  SELECT
    count(DISTINCT stock_id),
    count(*),
    count(DISTINCT stock_id) FILTER (
      WHERE stock_id IN (
        SELECT stock_id FROM public.tw_bsr_daily
        WHERE trade_date = _trade_date
        GROUP BY stock_id
        HAVING count(DISTINCT broker_id) >= v_bsr_min_brokers_per_stock
      )
    )
  INTO v_bsr_stocks, v_bsr_broker_rows, v_bsr_stocks_with_min
  FROM public.tw_bsr_daily
  WHERE trade_date = _trade_date;

  IF v_bsr_stocks_with_min >= v_bsr_min_stocks THEN
    v_lane_a := 'sealed';
  ELSIF v_bsr_stocks_with_min > 0 THEN
    v_lane_a := 'partial';
  ELSE
    v_lane_a := 'pending';
  END IF;

  -- ---- Lane B/C/D: Institutional coverage ----
  SELECT count(DISTINCT stock_id) INTO v_inst_stocks
  FROM public.tw_institutional_daily
  WHERE trade_date = _trade_date;

  SELECT count(DISTINCT stock_id) INTO v_inst_twse
  FROM public.tw_institutional_daily
  WHERE trade_date = _trade_date AND source = 'twse_bfi82u';

  SELECT count(DISTINCT stock_id) INTO v_inst_tpex
  FROM public.tw_institutional_daily
  WHERE trade_date = _trade_date AND source = 'tpex_bulk';

  SELECT count(DISTINCT stock_id) INTO v_inst_t86
  FROM public.tw_institutional_daily
  WHERE trade_date = _trade_date AND source = 't86';

  -- Lane B (TWSE BFI82U): sealed if either dedicated source or legacy 'unknown' covers most stocks
  IF v_inst_stocks >= v_inst_min_stocks THEN
    v_lane_b := CASE WHEN v_inst_twse > 0 OR v_inst_stocks > 0 THEN 'sealed' ELSE 'partial' END;
    v_lane_c := CASE WHEN v_inst_tpex > 0 OR v_inst_stocks > 0 THEN 'sealed' ELSE 'partial' END;
  ELSIF v_inst_stocks > 0 THEN
    v_lane_b := 'partial';
    v_lane_c := 'partial';
  END IF;

  -- ---- Overall seal decision ----
  IF v_lane_a = 'sealed' AND v_lane_b = 'sealed' AND v_lane_c = 'sealed' THEN
    v_sealed_at := now();
    v_sealed_by_lane := 'ALL';
  ELSIF v_lane_a = 'sealed' AND v_lane_b <> 'sealed' THEN
    v_sealed_by_lane := 'A_ONLY';
    v_notes := 'BSR sealed, institutional coverage insufficient';
  ELSIF v_lane_a <> 'sealed' AND v_lane_b = 'sealed' THEN
    v_sealed_by_lane := 'BC_ONLY';
    v_notes := 'Institutional sealed, BSR coverage insufficient';
  END IF;

  -- ---- Persist status ----
  INSERT INTO public.tw_bsr_daily_snapshot_status (
    trade_date, status,
    lane_a_status, lane_b_status, lane_c_status,
    sealed_at, sealed_by_lane,
    coverage_stocks, coverage_brokers,
    updated_at
  ) VALUES (
    _trade_date,
    CASE WHEN v_sealed_at IS NOT NULL THEN 'ready' ELSE 'partial' END,
    v_lane_a, v_lane_b, v_lane_c,
    v_sealed_at, v_sealed_by_lane,
    v_bsr_stocks_with_min, v_bsr_broker_rows,
    now()
  )
  ON CONFLICT (trade_date) DO UPDATE SET
    lane_a_status = EXCLUDED.lane_a_status,
    lane_b_status = EXCLUDED.lane_b_status,
    lane_c_status = EXCLUDED.lane_c_status,
    -- Preserve existing sealed_at once set (immutability at the status layer)
    sealed_at = COALESCE(public.tw_bsr_daily_snapshot_status.sealed_at, EXCLUDED.sealed_at),
    sealed_by_lane = COALESCE(public.tw_bsr_daily_snapshot_status.sealed_by_lane, EXCLUDED.sealed_by_lane),
    coverage_stocks = GREATEST(public.tw_bsr_daily_snapshot_status.coverage_stocks, EXCLUDED.coverage_stocks),
    coverage_brokers = GREATEST(public.tw_bsr_daily_snapshot_status.coverage_brokers, EXCLUDED.coverage_brokers),
    status = CASE
      WHEN public.tw_bsr_daily_snapshot_status.sealed_at IS NOT NULL THEN 'ready'
      WHEN EXCLUDED.sealed_at IS NOT NULL THEN 'ready'
      ELSE EXCLUDED.status
    END,
    updated_at = now();

  RETURN QUERY SELECT
    _trade_date,
    v_lane_a, v_lane_b, v_lane_c,
    v_sealed_at, v_sealed_by_lane,
    v_bsr_stocks_with_min, v_bsr_broker_rows,
    v_bsr_stocks, v_inst_stocks,
    v_notes;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_snapshot(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_snapshot(date) TO service_role;

COMMENT ON FUNCTION public.reconcile_snapshot(date) IS
  'P2 arbiter: independently seals Lane A (BSR) and Lane B/C/D (Institutional). '
  'Overall sealed_at only set when both dimensions sealed. Immutable once set.';

-- =========================================================================
-- P2.3: materialize_bsr_daily_from_fact — dedupe multi-source fact into canonical
-- =========================================================================
-- Priority: broker scraper wins over FinMind when both present for same (stock,date,broker).
-- Only writes if target date is NOT yet sealed (immutability guard).
CREATE OR REPLACE FUNCTION public.materialize_bsr_daily_from_fact(_trade_date date)
RETURNS TABLE (
  materialized_rows int,
  skipped_sealed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_sealed boolean := false;
  v_count int := 0;
BEGIN
  SELECT (sealed_at IS NOT NULL) INTO v_is_sealed
  FROM public.tw_bsr_daily_snapshot_status
  WHERE trade_date = _trade_date;

  IF COALESCE(v_is_sealed, false) THEN
    RETURN QUERY SELECT 0, true;
    RETURN;
  END IF;

  -- Bypass immutability trigger for this authorized materializer
  PERFORM set_config('app.force_reseal', 'true', true);

  WITH ranked AS (
    SELECT
      stock_id, trade_date, broker_id, broker_name,
      buy_shares, sell_shares, net_shares,
      avg_buy_price, avg_sell_price,
      row_number() OVER (
        PARTITION BY stock_id, trade_date, broker_id
        ORDER BY
          CASE source
            WHEN 'broker_scraper' THEN 1
            WHEN 'finmind_batch' THEN 2
            WHEN 'finmind_per_stock' THEN 3
            ELSE 9
          END,
          ingested_at DESC
      ) AS rn
    FROM public.tw_chip_fact
    WHERE trade_date = _trade_date
  ),
  ins AS (
    INSERT INTO public.tw_bsr_daily (
      stock_id, trade_date, broker_id, broker_name,
      buy_shares, sell_shares, net_shares,
      avg_buy_price, avg_sell_price
    )
    SELECT
      stock_id, trade_date, broker_id, broker_name,
      buy_shares, sell_shares, net_shares,
      avg_buy_price, avg_sell_price
    FROM ranked
    WHERE rn = 1
    ON CONFLICT (stock_id, trade_date, broker_id) DO UPDATE SET
      broker_name = EXCLUDED.broker_name,
      buy_shares = EXCLUDED.buy_shares,
      sell_shares = EXCLUDED.sell_shares,
      net_shares = EXCLUDED.net_shares,
      avg_buy_price = EXCLUDED.avg_buy_price,
      avg_sell_price = EXCLUDED.avg_sell_price
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  PERFORM set_config('app.force_reseal', 'false', true);

  RETURN QUERY SELECT v_count, false;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_bsr_daily_from_fact(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_bsr_daily_from_fact(date) TO service_role;

COMMENT ON FUNCTION public.materialize_bsr_daily_from_fact(date) IS
  'P2 materializer: dedupes tw_chip_fact into tw_bsr_daily using source priority '
  '(broker_scraper > finmind_batch > finmind_per_stock). Refuses to run on sealed dates.';
