-- 籌碼預抓 universe / registry / queue 契約測試
-- workflow: .github/workflows/finmind-admit-sql-tests.yml
-- 執行前置：apply 整個 supabase/migrations/ 目錄（filename 排序）。

\set ON_ERROR_STOP on
BEGIN;

-- ─────────────────────────────────────────────
-- Case 1：registry seed 必須含 20 檔 demo_seed，且 supported 分類正確
-- ─────────────────────────────────────────────
DO $$
DECLARE n int; n_sup int; n_unsup int;
BEGIN
  SELECT count(*) INTO n FROM public.chips_prefetch_targets WHERE source = 'demo_seed';
  ASSERT n = 20, format('case1: demo_seed rows expect 20 got %s', n);

  SELECT count(*) INTO n_sup   FROM public.chips_prefetch_targets WHERE source='demo_seed' AND supported;
  SELECT count(*) INTO n_unsup FROM public.chips_prefetch_targets WHERE source='demo_seed' AND NOT supported;
  ASSERT n_sup = 16,   format('case1: supported expect 16 got %s', n_sup);
  ASSERT n_unsup = 4,  format('case1: unsupported expect 4 got %s', n_unsup);

  -- ETF / 權證一律 unsupported 且有 reason
  ASSERT (SELECT bool_and(NOT supported AND reason IS NOT NULL)
            FROM public.chips_prefetch_targets
           WHERE code IN ('00637L','039108','053848','702157')),
         'case1: ETF/warrant must be unsupported with a reason';
END $$;

-- ─────────────────────────────────────────────
-- Case 2：universe 只允許 ^[1-9]\d{3}$ 進 BSR，且會標 sources
-- ─────────────────────────────────────────────
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM public.checkup_prefetch_universe() u
   WHERE u.supported AND u.code !~ '^[1-9][0-9]{3}$';
  ASSERT bad = 0, format('case2: supported non-4digit codes leaked: %s', bad);

  ASSERT (SELECT 'registry' = ANY(sources) FROM public.checkup_prefetch_universe() WHERE code = '3017'),
         'case2: 3017 must be sourced from registry';
END $$;

-- ─────────────────────────────────────────────
-- Case 3：checkup_storage 兩種形狀（array / {holdings:[]}）都要被解析，且會去重
-- ─────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local')
ON CONFLICT DO NOTHING;

INSERT INTO public.checkup_storage (user_id, key, data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'pf-holdings-v2', '[{"code":"2330"},{"code":"3017"}]'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'pf-holdings-v2', '{"holdings":[{"symbol":"2454"}]}'::jsonb)
ON CONFLICT (user_id, key) DO UPDATE SET data = EXCLUDED.data;

DO $$
DECLARE n int;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.checkup_prefetch_universe() WHERE code = '2330'),
         'case3: array shape not parsed';
  ASSERT EXISTS (SELECT 1 FROM public.checkup_prefetch_universe() WHERE code = '2454'),
         'case3: {holdings:[]} shape not parsed';
  -- 3017 同時來自 registry 與 checkup_storage，只能有一列
  SELECT count(*) INTO n FROM public.checkup_prefetch_universe() WHERE code = '3017';
  ASSERT n = 1, format('case3: dedupe failed, 3017 rows = %s', n);
END $$;

-- ─────────────────────────────────────────────
-- Case 4：gap detection 只回 supported 個股
-- ─────────────────────────────────────────────
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM public.detect_chip_gap_jobs(CURRENT_DATE, 5, 1000) g
   WHERE g.stock_id !~ '^[1-9][0-9]{3}$';
  ASSERT bad = 0, format('case4: unsupported codes in chip gap jobs: %s', bad);

  SELECT count(*) INTO bad
    FROM public.detect_institutional_gap_jobs(CURRENT_DATE, 5, 1000) g
   WHERE g.stock_id !~ '^[1-9][0-9]{3}$';
  ASSERT bad = 0, format('case4: unsupported codes in institutional gap jobs: %s', bad);
END $$;

-- ─────────────────────────────────────────────
-- Case 5：同一 stock 多次偵測只產生一個 job（idempotent enqueue）
-- ─────────────────────────────────────────────
DELETE FROM public.tw_bsr_sync_queue;

DO $$
DECLARE r1 jsonb; r2 jsonb; dupes int;
BEGIN
  r1 := public.enqueue_chips_prefetch_gaps(5, 100);
  r2 := public.enqueue_chips_prefetch_gaps(5, 100);

  ASSERT (r2->>'inserted')::int = 0,
         format('case5: second run must insert 0, got %s (first=%s)', r2->>'inserted', r1->>'inserted');

  SELECT count(*) INTO dupes FROM (
    SELECT stock_id, trade_date FROM public.tw_bsr_sync_queue
     WHERE status IN ('pending','running','failed','skipped')
     GROUP BY 1,2 HAVING count(*) > 1
  ) d;
  ASSERT dupes = 0, format('case5: duplicate active queue rows: %s', dupes);

  -- unsupported 永遠不得進佇列
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.tw_bsr_sync_queue WHERE stock_id !~ '^[1-9][0-9]{3}$'
  ), 'case5: unsupported code entered queue';
END $$;

-- ─────────────────────────────────────────────
-- Case 6：recovery 有 bounded retry，且不碰 unsupported
-- ─────────────────────────────────────────────
DO $$
DECLARE r jsonb; still_failed int;
BEGIN
  UPDATE public.tw_bsr_sync_queue SET status='failed', attempts=1 WHERE stock_id='3017';
  UPDATE public.tw_bsr_sync_queue SET status='failed', attempts=99, max_attempts=5 WHERE stock_id='4583';

  r := public.recover_stale_bsr_queue_jobs(30, 5);
  ASSERT (r->>'retry_requeued')::int > 0, format('case6: expected requeue, got %s', r);

  -- 超過 max_attempts 的不得被 requeue
  SELECT count(*) INTO still_failed
    FROM public.tw_bsr_sync_queue WHERE stock_id='4583' AND status='failed';
  ASSERT still_failed > 0, 'case6: exhausted job must stay failed';
END $$;

-- ─────────────────────────────────────────────
-- Case 7：enqueue_bsr_backfill 的使用者隔離
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;

-- 未登入 → 直接拒絕
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('test.uid', '', true);
  BEGIN
    PERFORM public.enqueue_bsr_backfill('3017', 5);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'case7: anonymous caller must be rejected';
END $$;

-- 使用者 A 持有 3017 → 允許
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
  n := public.enqueue_bsr_backfill('3017', 5);
  ASSERT n >= 0, format('case7: owner backfill failed, got %s', n);
END $$;

-- 使用者 B 未持有 3017（只有 2454）→ 必須拒絕，不能讀到 A 的資料
DO $$
DECLARE denied boolean := false;
BEGIN
  PERFORM set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  BEGIN
    PERFORM public.enqueue_bsr_backfill('3017', 5);
  EXCEPTION WHEN OTHERS THEN denied := true;
  END;
  ASSERT denied, 'case7: cross-user backfill must be denied (user isolation)';
END $$;

-- ─────────────────────────────────────────────
-- Case 8：cron schedule / command assertions
-- ─────────────────────────────────────────────
DO $$
DECLARE has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') INTO has_cron;
  IF NOT has_cron THEN
    RAISE NOTICE 'case8 skipped: pg_cron not installed in this container';
    RETURN;
  END IF;

  ASSERT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'chips-prefetch-enqueue-hourly'
       AND schedule = '2 * * * *'
       AND active
       AND command LIKE '%enqueue_chips_prefetch_gaps%'
  ), 'case8: hourly :02 enqueue job missing/misconfigured';

  -- pg_cron 以 UTC 解讀排程。worker 必須全天每小時跑，否則 13–23 UTC 期間
  -- enqueue 出來的 job 會滯留到隔日 00 UTC 才有 worker 領取。
  -- 配額保護由 gap detection 去重 + finmind admission budget 負責，不靠限制時段。
  ASSERT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'tw-bsr-worker-hourly'
       AND schedule = '7 * * * *'
       AND active
       AND command LIKE '%tw-bsr-finmind-sync%'
  ), 'case8: hourly :07 worker job must run 24h (7 * * * *)';

  -- 明確禁止回退成只跑部分時段
  ASSERT NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'tw-bsr-worker-hourly'
       AND schedule LIKE '%0-12%'
  ), 'case8: worker schedule must not be window-restricted (queue would stall overnight)';

END $$;

ROLLBACK;
