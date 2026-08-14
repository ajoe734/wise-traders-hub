-- P6-R1：Lane A 公平性 / priority routing / contract 凍結測試
-- 執行：bash scripts/ephemeral-pg.sh run-file supabase/tests/chips_lane_a_fairness_test.sql
-- 前置：up-slice → load-slice → 載入 bsr_e2e_schema.sql + bsr_e2e_functions.sql

\set ON_ERROR_STOP on
BEGIN;

-- ─────────────────────────────────────────────
-- Case 1：detect_chip_gap_jobs 對外 contract 逐字不變
-- ─────────────────────────────────────────────
DO $$
DECLARE ret text; args text;
BEGIN
  SELECT pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid)
    INTO ret, args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'detect_chip_gap_jobs';
  ASSERT ret = 'TABLE(stock_id text, start_date date, end_date date, gap_count integer)',
         format('case1: return contract drift: %s', ret);
  ASSERT args = '_target_date date, _lookback_days integer, _max_jobs integer',
         format('case1: arg contract drift: %s', args);

  SELECT pg_get_function_result(p.oid) INTO ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enqueue_chips_prefetch_gaps';
  ASSERT ret = 'jsonb', format('case1: enqueue return drift: %s', ret);
END $$;

-- ─────────────────────────────────────────────
-- seed：1 檔使用者持股（2330）、1 檔 open 專家部位（2317）、
--       1 檔 closed 專家部位（2454）、1 檔 registry 冷門股（3017）
-- ─────────────────────────────────────────────
DELETE FROM public.tw_bsr_sync_queue;
DELETE FROM public.tw_bsr_daily;
DELETE FROM public.checkup_storage;
DELETE FROM public.trade_records;
DELETE FROM public.expert_signals;
UPDATE public.chips_prefetch_targets SET active = false;

INSERT INTO public.chips_prefetch_targets (code, active, source, supported)
VALUES ('3017', true, 'test', true)
ON CONFLICT (code) DO UPDATE SET active = true, supported = true;

INSERT INTO public.checkup_storage (user_id, key, data)
VALUES ('11111111-1111-1111-1111-111111111111', 'pf-holdings-v2', '[{"code":"2330"}]'::jsonb)
ON CONFLICT (user_id, key) DO UPDATE SET data = EXCLUDED.data;

INSERT INTO public.trade_records (id, expert_id, instrument, entry_price, entry_date, status, market)
VALUES (gen_random_uuid(), gen_random_uuid(), '2317 鴻海', 100, now(), 'open', 'TW'),
       (gen_random_uuid(), gen_random_uuid(), '2454 聯發科', 100, now(), 'closed', 'TW');

-- ─────────────────────────────────────────────
-- Case 2：持股缺 1 日 vs 冷門股缺多日 → 持股先返回
-- ─────────────────────────────────────────────
DO $$
DECLARE d date := (SELECT max(td) FROM public.tw_trading_days(CURRENT_DATE - 30, CURRENT_DATE) td);
        first_code text;
BEGIN
  -- 冷門股 3017 完全沒有資料（缺很多日）；2330 只缺最新一日
  INSERT INTO public.tw_bsr_daily (stock_id, trade_date, buy_shares, sell_shares, net_shares)
  SELECT '2330', td, 0, 0, 0
    FROM public.tw_trading_days(CURRENT_DATE - 30, CURRENT_DATE) td
   WHERE td < d
  ON CONFLICT DO NOTHING;

  SELECT stock_id INTO first_code
    FROM public.detect_chip_gap_jobs(d, 20, 100) LIMIT 1;
  ASSERT first_code = '2330',
         format('case2: saved holding must rank first, got %s', first_code);
END $$;

-- ─────────────────────────────────────────────
-- Case 3：priority routing —— 持股 1、open 專家部位 2、其餘 3
-- ─────────────────────────────────────────────
DO $$
DECLARE p1 int; p2 int; p3 int; p4 int;
BEGIN
  PERFORM public.enqueue_chips_prefetch_gaps(5, 100);

  SELECT min(priority) INTO p1 FROM public.tw_bsr_sync_queue WHERE stock_id = '2330';
  SELECT min(priority) INTO p2 FROM public.tw_bsr_sync_queue WHERE stock_id = '2317';
  SELECT min(priority) INTO p3 FROM public.tw_bsr_sync_queue WHERE stock_id = '3017';
  SELECT min(priority) INTO p4 FROM public.tw_bsr_sync_queue WHERE stock_id = '2454';

  ASSERT p1 = 1, format('case3: saved holding priority expect 1 got %s', p1);
  ASSERT p2 = 2, format('case3: open trade_records priority expect 2 got %s', p2);
  ASSERT p3 = 3, format('case3: registry priority expect 3 got %s', p3);
  ASSERT p4 IS NULL OR p4 = 3, format('case3: closed trade_records must not be rank 2, got %s', p4);

  ASSERT (SELECT bool_and(priority IN (1,2,3)) FROM public.tw_bsr_sync_queue),
         'case3: priority must stay within CHECK (1,2,3)';
  ASSERT (SELECT bool_and(enqueued_by LIKE 'chips_prefetch_hourly:r%')
            FROM public.tw_bsr_sync_queue WHERE enqueued_by LIKE 'chips_prefetch_hourly%'),
         'case3: enqueued_by must carry rank suffix';
END $$;

-- ─────────────────────────────────────────────
-- Case 4：冪等 —— 連兩次呼叫第二次 inserted = 0
-- ─────────────────────────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  r := public.enqueue_chips_prefetch_gaps(5, 100);
  ASSERT (r->>'inserted')::int = 0, format('case4: second run inserted expect 0 got %s', r->>'inserted');
END $$;

-- ─────────────────────────────────────────────
-- Case 5：已 pending/running 的 (stock, date) 不再佔用 _max_jobs 名額
-- ─────────────────────────────────────────────
DO $$
DECLARE n_before int; n_after int;
        d date := (SELECT max(td) FROM public.tw_trading_days(CURRENT_DATE - 30, CURRENT_DATE) td);
BEGIN
  SELECT count(*) INTO n_before FROM public.detect_chip_gap_jobs(d, 20, 100);
  ASSERT n_before = 0,
         format('case5: all gaps already queued as pending → detect must return 0, got %s', n_before);

  UPDATE public.tw_bsr_sync_queue SET status = 'failed';
  SELECT count(*) INTO n_after FROM public.detect_chip_gap_jobs(d, 20, 100);
  ASSERT n_after > 0, 'case5: failed jobs must remain visible as candidates';
END $$;

-- ─────────────────────────────────────────────
-- Case 6：分頁公平性 —— _max_jobs 小於待補檔數時，連續輪次要輪完全部；
--         其中 1 檔 failed 不得阻塞其餘
-- ─────────────────────────────────────────────
DELETE FROM public.tw_bsr_sync_queue;
DELETE FROM public.tw_bsr_daily;
DELETE FROM public.checkup_storage;
UPDATE public.chips_prefetch_targets SET active = false;

DO $$
DECLARE codes jsonb := '[]'::jsonb; i int; c text;
BEGIN
  FOR i IN 1..12 LOOP
    c := (2000 + i)::text;
    codes := codes || jsonb_build_array(jsonb_build_object('code', c));
  END LOOP;
  INSERT INTO public.checkup_storage (user_id, key, data)
  VALUES ('11111111-1111-1111-1111-111111111111', 'pf-holdings-v2', codes)
  ON CONFLICT (user_id, key) DO UPDATE SET data = EXCLUDED.data;
END $$;

DO $$
DECLARE d date := (SELECT max(td) FROM public.tw_trading_days(CURRENT_DATE - 30, CURRENT_DATE) td);
        seen text[] := '{}';
        r record; round int; total int;
BEGIN
  FOR round IN 1..6 LOOP
    FOR r IN SELECT stock_id FROM public.detect_chip_gap_jobs(d, 1, 3) LOOP
      seen := seen || r.stock_id;
      -- 模擬入隊；第 1 檔永遠 failed（不得阻塞其餘）
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES (r.stock_id, d, 1,
              CASE WHEN r.stock_id = '2001' THEN 'failed' ELSE 'done' END,
              now(), 'fairness_test', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      IF r.stock_id <> '2001' THEN
        INSERT INTO public.tw_bsr_daily (stock_id, trade_date, buy_shares, sell_shares, net_shares)
        VALUES (r.stock_id, d, 0, 0, 0) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  SELECT count(DISTINCT x) INTO total FROM unnest(seen) x;
  ASSERT total = 12,
         format('case6: expect all 12 saved codes rotated within 6 rounds, got %s (%s)', total, seen);
END $$;

ROLLBACK;
