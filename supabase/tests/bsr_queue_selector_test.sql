-- Stage 3B / S3B-0 baseline test — worker selector 與 backlog terminalization 的前置事實
--
-- 本檔是 baseline GREEN。S3B-E 只會把「當下 status='pending'」的 job 轉成 'skipped'，
-- 所以在動 backlog 之前必須先用測試釘死兩件事實：
--   1) claim_bsr_queue_jobs 只挑 status='pending'，因此轉成 'skipped' 之後 worker 不會再撿。
--   2) tw_bsr_sync_queue 沒有 provider / dataset 之類的鑑別欄位，
--      也就是 WHERE status='pending' 一定只涵蓋 BSR job，不會誤殺其他 provider 的工作。
--      （唯一的來源標記是 enqueued_by 這個自由文字欄位。）
--   3) recover_stale_bsr_queue_jobs 會把 'skipped' 撿回 pending —— 這是已知回流風險，
--      S3B-A 必須讓 recovery 也吃 gate，否則 backlog terminalization 會被自然 cron 撤銷。
--
-- 隔離協定（v4.1）：BEGIN + SAVEPOINT fixture + 最終 ROLLBACK，assertion 失敗也由外層
-- 交易回滾；前後比對 production queue count / config hash 必須 0 delta。
--
-- 執行：psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_queue_selector_test.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _baseline AS
SELECT
  (SELECT count(*) FROM public.tw_bsr_sync_queue)                            AS queue_rows,
  (SELECT md5(COALESCE(string_agg(id::text || ':' || status, '|' ORDER BY id), ''))
     FROM public.tw_bsr_sync_queue)                                          AS queue_hash,
  (SELECT md5(COALESCE(string_agg(key || ':' || version || ':' || config::text, '|'
                                  ORDER BY key), ''))
     FROM public.tw_bsr_sync_config)                                         AS config_hash;

-- ─────────────────────────────────────────────
-- Case 1：queue 沒有 provider/dataset 鑑別欄位 → status='pending' 即等於「全部 BSR job」
-- ─────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(column_name, ',') INTO bad
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tw_bsr_sync_queue'
     AND column_name IN ('provider','dataset','job_type','source','kind');
  ASSERT bad IS NULL,
    format('case1: queue 出現鑑別欄位 (%s) —— S3B-E 的 WHERE status=''pending'' '
           '不再安全，必須改成帶鑑別條件', bad);

  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='tw_bsr_sync_queue'
                    AND column_name='enqueued_by'),
    'case1: enqueued_by 欄位不存在 —— 失去唯一的來源標記';
END $$;

-- ─────────────────────────────────────────────
-- Case 2（fixture）：claim 只撿 pending，'skipped' 不會被撿
-- ─────────────────────────────────────────────
SAVEPOINT fx_claim;

INSERT INTO public.tw_bsr_sync_queue
  (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
VALUES
  ('1101', date '1990-01-02', 1, 'pending', now() - interval '1 hour',
   's3b0_fixture', gen_random_uuid(), false),
  ('1102', date '1990-01-02', 1, 'skipped', now() - interval '1 hour',
   's3b0_fixture', gen_random_uuid(), false);

DO $$
DECLARE picked text[];
BEGIN
  SELECT array_agg(stock_id ORDER BY stock_id) INTO picked
    FROM public.claim_bsr_queue_jobs(50, 3) q
   WHERE q.enqueued_by = 's3b0_fixture';

  ASSERT picked = ARRAY['1101'],
    format('case2: claim 應只撿 pending fixture，實得 %s', picked);
END $$;

ROLLBACK TO SAVEPOINT fx_claim;

-- ─────────────────────────────────────────────
-- Case 3（fixture）：recover_stale_bsr_queue_jobs 目前會把 skipped 撿回 pending
--   這是 S3B-A 必須關掉的回流路徑；本檔釘住「現況如此」，S3B-A 之後由
--   bsr_ingest_suppression_test.sql 反轉為 recovery 也被 gate 擋下。
-- ─────────────────────────────────────────────
SAVEPOINT fx_recover;

INSERT INTO public.chips_prefetch_targets (code, active)
VALUES ('1103', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.tw_bsr_sync_queue
  (stock_id, trade_date, priority, status, next_run_at, attempts, max_attempts,
   enqueued_by, correlation_id, post_close_only)
VALUES
  ('1103', date '1990-01-03', 1, 'skipped', now(), 0, 5,
   's3b0_fixture', gen_random_uuid(), false);

DO $$
DECLARE st text;
BEGIN
  PERFORM public.recover_stale_bsr_queue_jobs(30, 5);
  SELECT status INTO st FROM public.tw_bsr_sync_queue
   WHERE enqueued_by = 's3b0_fixture' AND stock_id = '1103';
  ASSERT st = 'pending',
    format('case3: 現況應為 recovery 把 skipped 撿回 pending，實得 %s', st);
END $$;

ROLLBACK TO SAVEPOINT fx_recover;

-- ─────────────────────────────────────────────
-- 零殘留驗證：fixture 已全數回滾，前後 count / hash 0 delta
-- ─────────────────────────────────────────────
DO $$
DECLARE b record; q bigint; qh text; ch text;
BEGIN
  SELECT * INTO b FROM _baseline;
  SELECT count(*) INTO q FROM public.tw_bsr_sync_queue;
  SELECT md5(COALESCE(string_agg(id::text || ':' || status, '|' ORDER BY id), '')) INTO qh
    FROM public.tw_bsr_sync_queue;
  SELECT md5(COALESCE(string_agg(key || ':' || version || ':' || config::text, '|'
                                 ORDER BY key), '')) INTO ch
    FROM public.tw_bsr_sync_config;
  ASSERT q = b.queue_rows,  format('residue: queue rows %s -> %s', b.queue_rows, q);
  ASSERT qh = b.queue_hash, format('residue: queue hash %s -> %s', b.queue_hash, qh);
  ASSERT ch = b.config_hash, format('residue: config hash %s -> %s', b.config_hash, ch);
END $$;

ROLLBACK;
