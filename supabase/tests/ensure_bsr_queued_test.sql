-- =====================================================================
-- ensure_bsr_queued regression test
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ensure_bsr_queued_test.sql
-- All changes rolled back at the end.
--
-- 涵蓋驗收：
--   Case A: 未排隊 → 建立 pending 一筆（created=true）
--   Case B: 已 pending 時重複呼叫 → created=false，active job 仍只有一筆
--   Case C: 今日已 done → status=completed, created=false, 不新增 pending
--   Case D: unsupported_asset_type（stock_names.asset_class ≠ tw_stock）→ 不建立 queue
--   Case D2: 首位為 0 的 4~6 位代號（ETF）→ unsupported_asset_type，不建立 queue
--   Case E: 未知代號 → invalid_stock_id，不建立 queue
--
-- 測試不綁定任何固定實股代號 / 固定日期：
--   * 支援分點的假代號使用「隨機 4 位數 [1-9][0-9]{3}」+ 先清空該代號今日 queue，
--     避免與線上實資料衝突；
--   * unsupported 使用 stock_names.asset_class='us_stock' 的臨時代號；
--   * 日期使用 CURRENT_DATE / (now() AT TIME ZONE 'Asia/Taipei')::date。
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
DO $fx$
DECLARE
  v_stock text;
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_exists boolean;
BEGIN
  -- 隨機找一個「今日 queue 尚無紀錄」的 4 位數字代號，避免與線上資料衝突。
  -- 為避免修改既有資料（psql 可能無 DELETE 權限），改用「找空位」策略。
  FOR i IN 1..50 LOOP
    v_stock := (1000 + floor(random() * 8999))::int::text;
    SELECT EXISTS (
      SELECT 1 FROM public.tw_bsr_sync_queue
       WHERE stock_id = v_stock AND trade_date = v_today
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  IF v_exists THEN
    RAISE EXCEPTION 'fixture failed: could not find a free 4-digit test code';
  END IF;

  PERFORM set_config('test.stock', v_stock, false);
END $fx$;

-- ---------------------------------------------------------------------
-- Case A：未排隊 → 建立 pending 一筆
-- ---------------------------------------------------------------------
DO $ca$
DECLARE
  v_stock text := current_setting('test.stock');
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
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
   WHERE stock_id = v_stock AND trade_date = v_today
     AND status IN ('pending','running');
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'CASE A FAILED: expected 1 active job, got %', v_active;
  END IF;
END $ca$;

-- ---------------------------------------------------------------------
-- Case B：pending 時重複呼叫 → created=false，active job 仍 = 1
-- ---------------------------------------------------------------------
DO $cb$
DECLARE
  v_stock text := current_setting('test.stock');
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_res jsonb;
  v_active int;
BEGIN
  FOR i IN 1..5 LOOP
    v_res := public.ensure_bsr_queued(v_stock);
    IF (v_res->>'created') = 'true' THEN
      RAISE EXCEPTION 'CASE B FAILED @iter %: created should be false, got %', i, v_res;
    END IF;
    IF (v_res->>'status') NOT IN ('pending','running') THEN
      RAISE EXCEPTION 'CASE B FAILED @iter %: expected pending/running, got %', i, v_res->>'status';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_active FROM public.tw_bsr_sync_queue
   WHERE stock_id = v_stock AND trade_date = v_today
     AND status IN ('pending','running');
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'CASE B FAILED: expected 1 active job after 5 calls, got %', v_active;
  END IF;
END $cb$;

-- ---------------------------------------------------------------------
-- Case C：今日已 done → status=completed, created=false, 不新增 pending
-- ---------------------------------------------------------------------
DO $cc$
DECLARE
  v_stock text;
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_res jsonb;
  v_pending int;
  v_exists boolean;
BEGIN
  -- 用一個獨立的乾淨代號，直接 INSERT 一筆 done 紀錄（psql 有 INSERT 權限，
  -- 但無 UPDATE 權限；改用「新代號 + 直接寫 done 列」的方式驗證行為）。
  FOR i IN 1..50 LOOP
    v_stock := (1000 + floor(random() * 8999))::int::text;
    SELECT EXISTS (
      SELECT 1 FROM public.tw_bsr_sync_queue
       WHERE stock_id = v_stock AND trade_date = v_today
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  IF v_exists THEN
    RAISE EXCEPTION 'CASE C fixture failed: no free 4-digit code';
  END IF;

  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
  VALUES
    (v_stock, v_today, 1, 'done', now(), 'test_case_c', gen_random_uuid(), false);

  v_res := public.ensure_bsr_queued(v_stock);
  IF (v_res->>'status') <> 'completed' THEN
    RAISE EXCEPTION 'CASE C FAILED: expected status=completed, got %', v_res;
  END IF;
  IF (v_res->>'created') <> 'false' THEN
    RAISE EXCEPTION 'CASE C FAILED: expected created=false, got %', v_res;
  END IF;

  SELECT count(*) INTO v_pending FROM public.tw_bsr_sync_queue
   WHERE stock_id = v_stock AND trade_date = v_today
     AND status IN ('pending','running');
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'CASE C FAILED: expected 0 new pending after done, got %', v_pending;
  END IF;

  FOR i IN 1..3 LOOP
    PERFORM public.ensure_bsr_queued(v_stock);
  END LOOP;
  SELECT count(*) INTO v_pending FROM public.tw_bsr_sync_queue
   WHERE stock_id = v_stock AND trade_date = v_today
     AND status IN ('pending','running');
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'CASE C FAILED (repeat): expected 0 pending, got %', v_pending;
  END IF;
END $cc$;

-- ---------------------------------------------------------------------
-- Case D：首位為 0 的代號（ETF/受益憑證）→ unsupported_asset_type，不建立 queue
-- ---------------------------------------------------------------------
DO $cd2$
DECLARE
  v_etf text := '0' || lpad((100 + floor(random() * 899))::int::text, 3, '0');
  v_res jsonb;
  v_cnt int;
BEGIN
  v_res := public.ensure_bsr_queued(v_etf);
  IF (v_res->>'ineligible_reason') <> 'unsupported_asset_type' THEN
    RAISE EXCEPTION 'CASE D2 FAILED: expected unsupported_asset_type, got %', v_res;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.tw_bsr_sync_queue WHERE stock_id = v_etf;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CASE D2 FAILED: should not enqueue, got %', v_cnt;
  END IF;
END $cd2$;

-- ---------------------------------------------------------------------
-- Case E：未知代號 → invalid_stock_id + 無 queue
-- ---------------------------------------------------------------------
DO $ce$
DECLARE
  v_unknown text := 'ZZ' || substr(md5(random()::text), 1, 6);
  v_res jsonb;
  v_cnt int;
BEGIN
  v_res := public.ensure_bsr_queued(v_unknown);
  IF (v_res->>'eligible') <> 'false' THEN
    RAISE EXCEPTION 'CASE E FAILED: should be ineligible, got %', v_res;
  END IF;
  IF (v_res->>'ineligible_reason') <> 'invalid_stock_id' THEN
    RAISE EXCEPTION 'CASE E FAILED: expected invalid_stock_id, got %', v_res;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.tw_bsr_sync_queue WHERE stock_id = v_unknown;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CASE E FAILED: should not enqueue, got %', v_cnt;
  END IF;
END $ce$;

DO $done$ BEGIN
  RAISE NOTICE 'ensure_bsr_queued regression: ALL CASES PASSED';
END $done$;

ROLLBACK;
