-- =====================================================================
-- ensure_bsr_queued regression test
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ensure_bsr_queued_test.sql
-- All changes rolled back at the end.
--
-- 涵蓋驗收：
--   Case A: 未排隊 → 建立 pending 一筆（created=true）
--   Case B: 已 pending / running 時重複呼叫 → created=false，active job 仍只有一筆
--   Case C: 今日已 done → 回 status=completed, created=false, 不新增 pending
--   Case D: unsupported_asset_type（ETF/權證）→ 不建立 queue
--   Case E: 未知代號 → ineligible，不建立 queue
--
-- 為避免綁定固定代號 / 固定日期，測試使用臨時插入的 stock_names 假代號
-- 和 CURRENT_DATE，未來股票池或日期變動不會影響本測試。
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------
-- Fixtures：一個支援分點的假台股 + 一個 ETF
-- ---------------------------------------------------------------------
DO $fx$
DECLARE
  v_stock text := 'T' || substr(md5(random()::text), 1, 4); -- eg. T9a3f
  v_etf   text := 'E' || substr(md5(random()::text), 1, 4);
BEGIN
  INSERT INTO public.stock_names (stock_id, name, asset_type)
  VALUES (v_stock, 'BSR Test Stock', 'stock')
  ON CONFLICT (stock_id) DO UPDATE SET asset_type = 'stock';

  INSERT INTO public.stock_names (stock_id, name, asset_type)
  VALUES (v_etf, 'BSR Test ETF', 'etf')
  ON CONFLICT (stock_id) DO UPDATE SET asset_type = 'etf';

  PERFORM set_config('test.stock', v_stock, false);
  PERFORM set_config('test.etf',   v_etf,   false);
END $fx$;

-- ---------------------------------------------------------------------
-- Case A：未排隊 → 建立 pending 一筆
-- ---------------------------------------------------------------------
SAVEPOINT case_a;
DO $ca$
DECLARE
  v_stock text := current_setting('test.stock');
  v_res jsonb;
  v_active int;
BEGIN
  v_res := public.ensure_bsr_queued(v_stock);
  IF (v_res->>'created') <> 'true' THEN
    RAISE EXCEPTION 'CASE A FAILED: expected created=true, got %', v_res;
  END IF;
  IF (v_res->>'status') NOT IN ('pending','running') THEN
    RAISE EXCEPTION 'CASE A FAILED: expected pending/running, got %', v_res->>'status';
  END IF;

  SELECT count(*) INTO v_active FROM public.tw_bsr_sync_queue
   WHERE stock_id = v_stock AND trade_date = CURRENT_DATE
     AND status IN ('pending','running');
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'CASE A FAILED: expected 1 active job, got %', v_active;
  END IF;
END $ca$;

-- ---------------------------------------------------------------------
-- Case B：pending 時重複呼叫 → created=false，active job 仍 = 1
-- ---------------------------------------------------------------------
SAVEPOINT case_b;
DO $cb$
DECLARE
  v_stock text := current_setting('test.stock');
  v_res jsonb;
  v_active int;
BEGIN
  FOR i IN 1..5 LOOP
    v_res := public.ensure_bsr_queued(v_stock);
    IF (v_res->>'created') = 'true' THEN
      RAISE EXCEPTION 'CASE B FAILED @iter %: created should be false, got %', i, v_res;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_active FROM public.tw_bsr_sync_queue
   WHERE stock_id = v_stock AND trade_date = CURRENT_DATE
     AND status IN ('pending','running');
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'CASE B FAILED: expected 1 active job after 5 calls, got %', v_active;
  END IF;
END $cb$;

-- ---------------------------------------------------------------------
-- Case C：今日已 done → status=completed, created=false, 不新增 pending
-- ---------------------------------------------------------------------
SAVEPOINT case_c;
DO $cc$
DECLARE
  v_stock text := current_setting('test.stock');
  v_res jsonb;
  v_pending int;
BEGIN
  -- 直接把先前那筆 pending 更新為 done
  UPDATE public.tw_bsr_sync_queue
     SET status = 'done', completed_at = now()
   WHERE stock_id = v_stock AND trade_date = CURRENT_DATE;

  v_res := public.ensure_bsr_queued(v_stock);
  IF (v_res->>'status') <> 'completed' THEN
    RAISE EXCEPTION 'CASE C FAILED: expected status=completed, got %', v_res;
  END IF;
  IF (v_res->>'created') <> 'false' THEN
    RAISE EXCEPTION 'CASE C FAILED: expected created=false, got %', v_res;
  END IF;

  SELECT count(*) INTO v_pending FROM public.tw_bsr_sync_queue
   WHERE stock_id = v_stock AND trade_date = CURRENT_DATE
     AND status IN ('pending','running');
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'CASE C FAILED: expected 0 new pending after done, got %', v_pending;
  END IF;

  -- 再連 3 次也不能建立新 pending
  FOR i IN 1..3 LOOP
    PERFORM public.ensure_bsr_queued(v_stock);
  END LOOP;
  SELECT count(*) INTO v_pending FROM public.tw_bsr_sync_queue
   WHERE stock_id = v_stock AND trade_date = CURRENT_DATE
     AND status IN ('pending','running');
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'CASE C FAILED (repeat): expected 0 pending, got %', v_pending;
  END IF;
END $cc$;

-- ---------------------------------------------------------------------
-- Case D：unsupported_asset_type（ETF）→ 不建立 queue
-- ---------------------------------------------------------------------
SAVEPOINT case_d;
DO $cd$
DECLARE
  v_etf text := current_setting('test.etf');
  v_res jsonb;
  v_cnt int;
BEGIN
  v_res := public.ensure_bsr_queued(v_etf);
  IF (v_res->>'eligible') <> 'false' THEN
    RAISE EXCEPTION 'CASE D FAILED: ETF should be ineligible, got %', v_res;
  END IF;
  IF (v_res->>'ineligible_reason') <> 'unsupported_asset_type' THEN
    RAISE EXCEPTION 'CASE D FAILED: expected reason=unsupported_asset_type, got %', v_res;
  END IF;

  SELECT count(*) INTO v_cnt FROM public.tw_bsr_sync_queue WHERE stock_id = v_etf;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CASE D FAILED: ETF should not enqueue, got % rows', v_cnt;
  END IF;
END $cd$;

-- ---------------------------------------------------------------------
-- Case E：完全未知代號 → ineligible + 無 queue
-- ---------------------------------------------------------------------
SAVEPOINT case_e;
DO $ce$
DECLARE
  v_unknown text := 'Z' || substr(md5(random()::text), 1, 6);
  v_res jsonb;
  v_cnt int;
BEGIN
  v_res := public.ensure_bsr_queued(v_unknown);
  IF (v_res->>'eligible') <> 'false' THEN
    RAISE EXCEPTION 'CASE E FAILED: unknown should be ineligible, got %', v_res;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.tw_bsr_sync_queue WHERE stock_id = v_unknown;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CASE E FAILED: unknown should not enqueue, got %', v_cnt;
  END IF;
END $ce$;

-- ---------------------------------------------------------------------
-- 所有測試通過
-- ---------------------------------------------------------------------
DO $done$ BEGIN
  RAISE NOTICE 'ensure_bsr_queued regression: ALL CASES PASSED';
END $done$;

ROLLBACK;
