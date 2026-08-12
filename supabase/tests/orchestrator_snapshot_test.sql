-- =====================================================================
-- tw-chips-orchestrator snapshot path regression test
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/orchestrator_snapshot_test.sql
-- All changes rolled back at the end.
--
-- 涵蓋驗收（2026-08-12 production failure 的防回歸）：
--   Case A: materialize_bsr_daily_from_fact 存在兩個 overload（date）與（date,text[]）
--   Case B: 只帶 _trade_date 的具名呼叫在 PostgREST 會 ambiguity；
--           以兩參數（_trade_date + _stock_ids:=NULL）具名呼叫必須唯一命中且可執行
--   Case C: reconcile_snapshot(_trade_date) 可執行且不得出現
--           42702 column reference "trade_date" is ambiguous
--   Case D: reconcile_snapshot 回傳 trade_date 必須等於傳入日期（OUT 欄位未被表欄位遮蔽）
--
-- 不綁定固定實股代號；使用未來的假交易日，避免動到線上快照。
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------
-- Case A: overload 盤點
-- ---------------------------------------------------------------------
DO $ca$
DECLARE
  v_n int;
  v_two int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'materialize_bsr_daily_from_fact';

  SELECT count(*) INTO v_two
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'materialize_bsr_daily_from_fact'
     AND pg_get_function_identity_arguments(p.oid) = '_trade_date date, _stock_ids text[]';

  IF v_n < 2 THEN
    RAISE EXCEPTION 'CASE A FAILED: expected >=2 overloads, got %', v_n;
  END IF;
  IF v_two <> 1 THEN
    RAISE EXCEPTION 'CASE A FAILED: (_trade_date date, _stock_ids text[]) signature missing';
  END IF;
END $ca$;

-- ---------------------------------------------------------------------
-- Case B: 兩參數具名呼叫唯一命中且可執行
-- ---------------------------------------------------------------------
DO $cb$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Taipei')::date + 3650;  -- 未來日，確定無資料
  v_rows int;
  v_sealed boolean;
BEGIN
  SELECT materialized_rows, skipped_sealed
    INTO v_rows, v_sealed
    FROM public.materialize_bsr_daily_from_fact(_trade_date => v_date, _stock_ids => NULL);

  IF v_rows IS NULL THEN
    RAISE EXCEPTION 'CASE B FAILED: materialized_rows is NULL';
  END IF;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'CASE B FAILED: future date should materialize 0 rows, got %', v_rows;
  END IF;
EXCEPTION
  WHEN ambiguous_function THEN
    RAISE EXCEPTION 'CASE B FAILED: two-arg named call is still ambiguous';
END $cb$;

-- ---------------------------------------------------------------------
-- Case C + D: reconcile_snapshot 無 trade_date ambiguity，且 OUT 值正確
-- ---------------------------------------------------------------------
DO $cc$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Taipei')::date + 3650;
  v_out date;
  v_lane_a text;
BEGIN
  SELECT r.trade_date, r.lane_a_status
    INTO v_out, v_lane_a
    FROM public.reconcile_snapshot(v_date) r;

  IF v_out IS DISTINCT FROM v_date THEN
    RAISE EXCEPTION 'CASE D FAILED: expected trade_date %, got %', v_date, v_out;
  END IF;
  IF v_lane_a IS NULL THEN
    RAISE EXCEPTION 'CASE D FAILED: lane_a_status is NULL';
  END IF;
EXCEPTION
  WHEN ambiguous_column THEN
    RAISE EXCEPTION 'CASE C FAILED: reconcile_snapshot still raises 42702 trade_date ambiguous';
END $cc$;

DO $done$ BEGIN
  RAISE NOTICE 'orchestrator snapshot regression: ALL CASES PASSED';
END $done$;

ROLLBACK;
