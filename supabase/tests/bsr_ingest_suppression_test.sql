-- Stage 3B / S3B-0 RED test — 七支 producer/recovery 必須先吃 gate 才能寫 queue
--
-- 事故背景：FinMind 已判定 provider_unsupported_plan（Stage 2 證據：HTTP 400
-- "Your level is register."），但七支入列函式仍持續把 job 推進 tw_bsr_sync_queue，
-- backlog 只會無限成長。S3B-A 要在這七支的最前面加 private_bsr.ingest_allowed()
-- early-return，回 {"skipped":"bsr_provider_unsupported"}（trigger 版本則直接 RETURN NEW）。
--
-- 本檔在 S3B-A 之前必須 RED（ingest_allowed 不存在 / producer 仍寫入）。
--
-- 隔離協定（v4.1）：BEGIN + SAVEPOINT fixture + 最終 ROLLBACK；
-- gate 開/關兩個分支都只在 fixture savepoint 內操作 config，不得用 production row
-- 直接測 open 分支；結束前比對 queue count / queue hash / config hash 為 0 delta。
--
-- 執行：psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_ingest_suppression_test.sql

\set ON_ERROR_STOP on
BEGIN;

\i supabase/tests/_s3b0_snapshot.sql
CALL s3b0_snapshot('before');

-- 註：helper 本身的存在／SECURITY DEFINER／STABLE／search_path／零授權契約，
-- 已由 supabase/tests/bsr_gate_ingest_allowed_test.sql 專檔覆蓋；本檔只測 producer 行為。

-- ─────────────────────────────────────────────
-- Case 3（fixture · gate 關閉）：producer 不得寫入任何 queue row，且回 skipped 語意
-- ─────────────────────────────────────────────
SAVEPOINT fx_closed;

INSERT INTO public.tw_bsr_sync_config (key, version, config)
VALUES ('market_batch', 8, jsonb_build_object(
          'admission_blocked', true,
          'admission_reason', 'provider_plan_rejected',
          'admission_terminal_code', 'bsr_provider_unsupported'))
ON CONFLICT (key) DO UPDATE
   SET version = 8, config = EXCLUDED.config;

INSERT INTO public.chips_prefetch_targets (code, active) VALUES ('1104', true)
ON CONFLICT DO NOTHING;

DO $$
DECLARE before_ct bigint; after_ct bigint; res jsonb; n int;
BEGIN
  SELECT count(*) INTO before_ct FROM public.tw_bsr_sync_queue;

  res := public.ensure_bsr_queued('1104');
  ASSERT res ? 'skipped' AND res->>'skipped' = 'bsr_provider_unsupported',
    format('case3: ensure_bsr_queued 應 early-return skipped，實得 %s', res);

  res := public.enqueue_all_active_tw_holdings_bsr(3);
  ASSERT res->>'skipped' = 'bsr_provider_unsupported',
    format('case3: enqueue_all_active_tw_holdings_bsr 應 early-return skipped，實得 %s', res);

  res := public.enqueue_chips_prefetch_gaps(3, 10);
  ASSERT res->>'skipped' = 'bsr_provider_unsupported',
    format('case3: enqueue_chips_prefetch_gaps 應 early-return skipped，實得 %s', res);

  res := public.recover_stale_bsr_queue_jobs(30, 5);
  ASSERT res->>'skipped' = 'bsr_provider_unsupported',
    format('case3: recover_stale_bsr_queue_jobs 應 early-return skipped，實得 %s', res);

  SELECT count(*) INTO after_ct FROM public.tw_bsr_sync_queue;
  ASSERT after_ct = before_ct,
    format('case3: gate 關閉時 queue 不得成長 (%s -> %s)', before_ct, after_ct);
END $$;

-- Case 3b：recovery 在 gate 關閉時不得把 skipped 撿回 pending
DO $$
DECLARE st text;
BEGIN
  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, next_run_at, attempts, max_attempts,
     enqueued_by, correlation_id, post_close_only)
  VALUES ('1104', date '1990-01-04', 1, 'skipped', now(), 0, 5,
          's3b0_fixture', gen_random_uuid(), false);

  PERFORM public.recover_stale_bsr_queue_jobs(30, 5);

  SELECT status INTO st FROM public.tw_bsr_sync_queue
   WHERE enqueued_by = 's3b0_fixture' AND stock_id = '1104';
  ASSERT st = 'skipped',
    format('case3b: gate 關閉時 skipped 不得回流 pending，實得 %s', st);
END $$;

ROLLBACK TO SAVEPOINT fx_closed;

-- ─────────────────────────────────────────────
-- Case 2：七支 producer/recovery 都必須在函式本體呼叫 gate helper
--   （靜態契約：避免日後有人新增分支繞過 early-return）
-- ─────────────────────────────────────────────
DO $$
DECLARE f text; src text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.enqueue_chips_prefetch_gaps(integer,integer)',
    'public.enqueue_all_active_tw_holdings_bsr(integer)',
    'public.enqueue_bsr_first_fetch_on_trade()',
    'public.ensure_bsr_queued(text)',
    'public.enqueue_bsr_backfill(text,integer)',
    'public.enqueue_bsr_first_fetch_on_trade()',
    'public.recover_stale_bsr_queue_jobs(integer,integer)'
  ] LOOP
    src := pg_get_functiondef(f::regprocedure);
    ASSERT src LIKE '%private_bsr.ingest_allowed()%',
      format('case2: %s 未呼叫 private_bsr.ingest_allowed() — S3B-A 未套用', f);
  END LOOP;
END $$;


-- ─────────────────────────────────────────────
-- Case 4（fixture · gate 開啟）：不得誤殺 —— gate 開時 producer 仍必須正常入列
--   注意：open 分支只在 fixture savepoint 內、用 fixture 個股測，
--   不使用任何 production row。
-- ─────────────────────────────────────────────
SAVEPOINT fx_open;

INSERT INTO public.tw_bsr_sync_config (key, version, config)
VALUES ('market_batch', 8, jsonb_build_object('admission_blocked', false))
ON CONFLICT (key) DO UPDATE SET version = 8, config = EXCLUDED.config;

DO $$
DECLARE res jsonb; n int;
BEGIN
  res := public.ensure_bsr_queued('1105');
  ASSERT NOT (res ? 'skipped'),
    format('case4: gate 開啟時不得 early-return，實得 %s', res);

  SELECT count(*) INTO n FROM public.tw_bsr_sync_queue WHERE stock_id = '1105';
  ASSERT n >= 1, 'case4: gate 開啟時 ensure_bsr_queued 應真的入列';
END $$;

ROLLBACK TO SAVEPOINT fx_open;

-- ─────────────────────────────────────────────
-- 零殘留驗證
-- ─────────────────────────────────────────────
CALL s3b0_assert_no_residue();

ROLLBACK;
