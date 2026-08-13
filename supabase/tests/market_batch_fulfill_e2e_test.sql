-- =====================================================================
-- Build2 P4 — market batch fulfill 端到端 SQL 契約測試（ephemeral only）
--
-- 前置：
--   bash scripts/ephemeral-pg.sh up-slice
--   bash scripts/ephemeral-pg.sh load-slice
--   bash scripts/ephemeral-pg.sh run-file supabase/tests/fixtures/bsr_e2e_schema.sql \
--        supabase/tests/fixtures/bsr_e2e_functions.sql
--   bash scripts/ephemeral-pg.sh run-file supabase/tests/market_batch_fulfill_e2e_test.sql
--
-- 覆蓋鏈路（DB 段）：
--   tw_chip_fact upsert（lane 優先序）
--     → materialize_bsr_daily_from_fact
--     → bsr_snapshot_mark（ready 封存）
--     → bsr_snapshot_fulfill_jobs（queue 收斂）
--     → refresh_bsr_coverage_daily（覆蓋率分類）
--   失敗分支：sealed skip、threshold 未達不 fulfill、idempotent 重跑。
-- 全部變更於結尾 ROLLBACK。
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ephemeral guard：production 上不可能成立
DO $$
BEGIN
  IF current_setting('bsr.ephemeral', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'refuse to run: 非 ephemeral cluster（bsr.ephemeral<>1）';
  END IF;
END $$;

CREATE TEMP TABLE _t(name text, passed boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.chk(_name text, _cond boolean, _detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _t VALUES (_name, COALESCE(_cond,false), _detail);
  IF NOT COALESCE(_cond,false) THEN
    RAISE EXCEPTION 'FAIL: % (%)', _name, _detail;
  END IF;
END $$;

-- ---------------------------------------------------------------- setup
\set D '''2026-08-13'''
DELETE FROM public.tw_chip_fact WHERE trade_date = :D::date;
DELETE FROM public.tw_bsr_daily WHERE trade_date = :D::date;
DELETE FROM public.tw_bsr_sync_queue WHERE trade_date = :D::date;
DELETE FROM public.tw_bsr_daily_snapshot_status WHERE trade_date = :D::date;
DELETE FROM public.bsr_coverage_daily WHERE trade_date = :D::date;
DELETE FROM public.daily_price_snapshots WHERE trade_date = :D::date;

INSERT INTO public.tw_bsr_daily_snapshot_status(trade_date, status)
VALUES (:D::date, 'pending');

-- queue：2330 會被市場整批滿足；9999 沒有資料 → 仍 pending
INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, status, priority)
VALUES ('2330', :D::date, 'pending', 100),
       ('2317', :D::date, 'running', 100),
       ('9999', :D::date, 'pending', 100);

-- 市場整批 lane 寫入 fact（finmind_batch）
INSERT INTO public.tw_chip_fact
  (stock_id, trade_date, broker_id, broker_name, source, buy_shares, sell_shares, avg_buy_price, avg_sell_price, ingested_at)
VALUES
  ('2330', :D::date, '1234', '甲券', 'finmind_batch', 150, 20, 10.5, 11.0, now()),
  ('2330', :D::date, '5678', '乙券', 'finmind_batch', 0, 70, NULL, 11.2, now()),
  ('2317', :D::date, '1234', '甲券', 'finmind_batch', 30, 10, 5.0, 5.1, now());

-- 同一分點的 per-stock lane（優先序較低，materialize 不得勝出）
INSERT INTO public.tw_chip_fact
  (stock_id, trade_date, broker_id, broker_name, source, buy_shares, sell_shares, avg_buy_price, avg_sell_price, ingested_at)
VALUES ('2330', :D::date, '1234', '甲券', 'finmind_per_stock', 1, 1, 1.0, 1.0, now());

INSERT INTO public.daily_price_snapshots(symbol, trade_date, volume_shares)
VALUES ('2330', :D::date, 180), ('2317', :D::date, 1000000);

-- ------------------------------------------------- 1) materialize 正確性
WITH m AS (SELECT * FROM public.materialize_bsr_daily_from_fact(:D::date, ARRAY['2330','2317']))
SELECT pg_temp.chk('materialize 寫入 3 列（2 檔 × 分點）',
  (SELECT materialized_rows FROM m) = 3, (SELECT materialized_rows::text FROM m));

SELECT pg_temp.chk('materialize 未被 sealed 擋下',
  NOT (SELECT skipped_sealed FROM public.materialize_bsr_daily_from_fact(:D::date, ARRAY['2330'])));

SELECT pg_temp.chk('lane 優先序：finmind_batch 勝過 finmind_per_stock',
  (SELECT buy_shares FROM public.tw_bsr_daily
    WHERE trade_date = :D::date AND stock_id='2330' AND broker_id='1234') = 150,
  (SELECT buy_shares::text FROM public.tw_bsr_daily
    WHERE trade_date = :D::date AND stock_id='2330' AND broker_id='1234'));

SELECT pg_temp.chk('net_shares 由 buy-sell 導出',
  (SELECT net_shares FROM public.tw_bsr_daily
    WHERE trade_date = :D::date AND stock_id='2330' AND broker_id='1234') = 130);

-- ------------------------------------------------- 2) idempotent 重跑
SELECT pg_temp.chk('重跑 materialize 不新增列（upsert 冪等）',
  (SELECT count(*) FROM public.tw_bsr_daily WHERE trade_date = :D::date) = 3
  AND (SELECT materialized_rows FROM public.materialize_bsr_daily_from_fact(:D::date, ARRAY['2330','2317'])) = 3
  AND (SELECT count(*) FROM public.tw_bsr_daily WHERE trade_date = :D::date) = 3);

-- ------------------------------------------------- 3) fulfill 門檻語意
WITH f AS (SELECT * FROM public.bsr_snapshot_fulfill_jobs(:D::date, 2))
SELECT pg_temp.chk('threshold=2：僅 2330 達標，2317/9999 續留',
  (SELECT fulfilled FROM f) = 1 AND (SELECT still_pending FROM f) = 2,
  (SELECT fulfilled || '/' || still_pending FROM f));

SELECT pg_temp.chk('2330 queue 已 done 且清空 last_error',
  (SELECT status FROM public.tw_bsr_sync_queue WHERE stock_id='2330' AND trade_date=:D::date) = 'done'
  AND (SELECT last_error FROM public.tw_bsr_sync_queue WHERE stock_id='2330' AND trade_date=:D::date) IS NULL);

WITH f AS (SELECT * FROM public.bsr_snapshot_fulfill_jobs(:D::date, 1))
SELECT pg_temp.chk('threshold=1：2317（running）亦被收斂，9999 無資料仍 pending',
  (SELECT fulfilled FROM f) = 1 AND (SELECT still_pending FROM f) = 1);

SELECT pg_temp.chk('9999 無 fact → 不得被誤判完成',
  (SELECT status FROM public.tw_bsr_sync_queue WHERE stock_id='9999' AND trade_date=:D::date) = 'pending');

-- ------------------------------------------------- 4) snapshot mark / seal
SELECT public.bsr_snapshot_mark(:D::date, 'ready', 'finmind_market_batch', 2, 3, NULL, 'finmind_batch');
SELECT pg_temp.chk('mark ready 會封存並記錄 lane 與 coverage',
  (SELECT status='ready' AND sealed_at IS NOT NULL AND sealed_by_lane='finmind_batch'
          AND coverage_stocks=2 AND coverage_rows=3 AND lock_expires_at IS NULL
     FROM public.tw_bsr_daily_snapshot_status WHERE trade_date=:D::date));

SELECT public.bsr_snapshot_mark(:D::date, 'ready', 'finmind_per_stock', 1, 1, NULL, 'finmind_per_stock');
SELECT pg_temp.chk('重複 mark 不改寫 sealed_by_lane，coverage 取最大值',
  (SELECT sealed_by_lane='finmind_batch' AND coverage_stocks=2 AND coverage_rows=3
     FROM public.tw_bsr_daily_snapshot_status WHERE trade_date=:D::date));

-- ------------------------------------------------- 5) sealed → materialize skip
INSERT INTO public.tw_chip_fact
  (stock_id, trade_date, broker_id, broker_name, source, buy_shares, sell_shares, ingested_at)
VALUES ('2454', :D::date, '1234', '甲券', 'finmind_batch', 99, 0, now());
WITH m AS (SELECT * FROM public.materialize_bsr_daily_from_fact(:D::date, ARRAY['2454']))
SELECT pg_temp.chk('已封存交易日：materialize 回 skipped_sealed 且 0 列',
  (SELECT skipped_sealed FROM m) AND (SELECT materialized_rows FROM m) = 0);
SELECT pg_temp.chk('已封存交易日不得新增 tw_bsr_daily 列',
  (SELECT count(*) FROM public.tw_bsr_daily WHERE trade_date=:D::date) = 3);

-- ------------------------------------------------- 6) coverage 刷新分類
SELECT public.refresh_bsr_coverage_daily(
  GREATEST((current_date - :D::date)::int + 1, 1));

SELECT pg_temp.chk('coverage 對每檔每日各一列',
  (SELECT count(*) FROM public.bsr_coverage_daily WHERE trade_date=:D::date) = 2);

SELECT pg_temp.chk('2330 coverage_pct = 分點買進量/成交量 → 83.33 且分類 ok',
  (SELECT coverage_pct = 83.33 AND coverage_class = 'ok' AND broker_count = 2
     FROM public.bsr_coverage_daily WHERE trade_date=:D::date AND stock_id='2330'),
  (SELECT coverage_pct::text || '/' || coverage_class
     FROM public.bsr_coverage_daily WHERE trade_date=:D::date AND stock_id='2330'));

SELECT pg_temp.chk('2317 分點量遠低於成交量 → broker_under_cover',
  (SELECT coverage_class = 'broker_under_cover'
     FROM public.bsr_coverage_daily WHERE trade_date=:D::date AND stock_id='2317'));

-- 缺 price snapshot → missing_snapshot
DELETE FROM public.daily_price_snapshots WHERE trade_date=:D::date AND symbol='2317';
SELECT public.refresh_bsr_coverage_daily(GREATEST((current_date - :D::date)::int + 1, 1));
SELECT pg_temp.chk('缺 daily_price_snapshots → missing_snapshot（不可算成 0%）',
  (SELECT coverage_class = 'missing_snapshot' AND coverage_pct IS NULL
     FROM public.bsr_coverage_daily WHERE trade_date=:D::date AND stock_id='2317'));

-- ------------------------------------------------- 7) eligibility 過濾
SELECT pg_temp.chk('tw_bsr_eligibility：4 碼普通股 eligible',
  public.tw_bsr_eligibility('2330') AND public.tw_bsr_eligibility('2317'));
SELECT pg_temp.chk('tw_bsr_eligibility：ETF/非 4 碼不 eligible',
  NOT public.tw_bsr_eligibility('0050') AND NOT public.tw_bsr_eligibility('00878')
  AND NOT public.tw_bsr_eligibility('2330A'));

-- ---------------------------------------------------------------- report
SELECT name, passed, detail FROM _t ORDER BY 1;
SELECT pg_temp.chk('E2E: 全部斷言通過', (SELECT bool_and(passed) FROM _t),
  (SELECT count(*)::text || ' assertions' FROM _t));
\echo 'MARKET-BATCH-FULFILL-E2E OK'

ROLLBACK;
