-- Build 1: 修正 reconcile_snapshot 的 OUT 欄位 trade_date 與資料表欄位撞名
-- 造成 "column reference \"trade_date\" is ambiguous"，orchestrator 500。
-- 邏輯與門檻不變，只做命名解析與表別名。
CREATE OR REPLACE FUNCTION public.reconcile_snapshot(_trade_date date)
RETURNS TABLE(
  trade_date date, lane_a_status text, lane_b_status text, lane_c_status text,
  sealed_at timestamp with time zone, sealed_by_lane text,
  coverage_stocks integer, coverage_brokers integer,
  bsr_stocks integer, inst_stocks integer, notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_bsr_min_stocks constant int := 500;
  v_bsr_min_brokers_per_stock constant int := 5;
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
    count(DISTINCT d.stock_id),
    count(*),
    count(DISTINCT d.stock_id) FILTER (
      WHERE d.stock_id IN (
        SELECT d2.stock_id FROM public.tw_bsr_daily d2
        WHERE d2.trade_date = _trade_date
        GROUP BY d2.stock_id
        HAVING count(DISTINCT d2.broker_id) >= v_bsr_min_brokers_per_stock
      )
    )
  INTO v_bsr_stocks, v_bsr_broker_rows, v_bsr_stocks_with_min
  FROM public.tw_bsr_daily d
  WHERE d.trade_date = _trade_date;

  -- ---- Lane B/C/D: Institutional coverage ----
  SELECT count(DISTINCT i.stock_id) INTO v_inst_stocks
  FROM public.tw_institutional_daily i WHERE i.trade_date = _trade_date;

  SELECT count(DISTINCT i.stock_id) INTO v_inst_twse
  FROM public.tw_institutional_daily i WHERE i.trade_date = _trade_date AND i.source = 'twse_bfi82u';

  SELECT count(DISTINCT i.stock_id) INTO v_inst_tpex
  FROM public.tw_institutional_daily i WHERE i.trade_date = _trade_date AND i.source = 'tpex_bulk';

  SELECT count(DISTINCT i.stock_id) INTO v_inst_t86
  FROM public.tw_institutional_daily i WHERE i.trade_date = _trade_date AND i.source = 't86';

  IF v_bsr_stocks_with_min >= v_bsr_min_stocks THEN
    v_lane_a := 'sealed';
  ELSIF v_bsr_stocks_with_min > 0 THEN
    v_lane_a := 'partial';
  ELSE
    v_lane_a := 'pending';
  END IF;

  IF v_inst_stocks >= v_inst_min_stocks THEN
    v_lane_b := CASE WHEN v_inst_twse > 0 OR v_inst_stocks > 0 THEN 'sealed' ELSE 'partial' END;
    v_lane_c := CASE WHEN v_inst_tpex > 0 OR v_inst_stocks > 0 THEN 'sealed' ELSE 'partial' END;
  ELSIF v_inst_stocks > 0 THEN
    v_lane_b := 'partial';
    v_lane_c := 'partial';
  END IF;

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

  INSERT INTO public.tw_bsr_daily_snapshot_status AS s (
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
    sealed_at = COALESCE(s.sealed_at, EXCLUDED.sealed_at),
    sealed_by_lane = COALESCE(s.sealed_by_lane, EXCLUDED.sealed_by_lane),
    coverage_stocks = GREATEST(s.coverage_stocks, EXCLUDED.coverage_stocks),
    coverage_brokers = GREATEST(s.coverage_brokers, EXCLUDED.coverage_brokers),
    status = CASE
      WHEN s.sealed_at IS NOT NULL THEN 'ready'
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
$function$;