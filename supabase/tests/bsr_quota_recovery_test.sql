-- =====================================================================
-- Build 1 contract test: defer_bsr_job_quota / recover_quota_failed_bsr_jobs
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bsr_quota_recovery_test.sql
-- All changes rolled back at the end (BEGIN ... ROLLBACK).
--
-- 涵蓋驗收：
--   Case A: quota 拒絕 → status 回 pending、attempts 抵銷 claim 的 +1、last_error='quota_deferred'
--   Case B: attempts=0 時抵銷不會變負
--   Case C: 只對 status='running' 生效（非 running 回 deferred=false，不改狀態）
--   Case D: recovery 有硬上限（cap），且只挑 quota 類 failed
--   Case E: recovery 用 max_attempts 當 retry token，達 8 後不再復活（防無限回收）
--   Case F: cap=0 → 不復活任何一筆，但仍誠實回報 remaining
--
-- 測試不綁定固定實股代號：使用隨機 9xxx 代號 + 未來日期，避免撞線上資料。
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

DO $t$
DECLARE
  v_stock text := '9' || lpad((floor(random()*900)::int + 99)::text, 3, '0');
  v_date  date := current_date + 400;   -- 遠期日期，不可能與線上資料衝突
  v_id    bigint;
  v_ids   bigint[];
  v_res   jsonb;
  v_row   public.tw_bsr_sync_queue;
  i       int;
BEGIN
  -- ---------------- Case A: quota 拒絕的合法轉移 ----------------
  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, attempts, max_attempts, started_at, next_run_at, enqueued_by)
  VALUES (v_stock, v_date, 2, 'running', 3, 5, now(), now(), 'contract_test')
  RETURNING id INTO v_id;

  v_res := public.defer_bsr_job_quota(v_id, 30);
  ASSERT (v_res->>'deferred')::boolean IS TRUE, 'Case A: 應回報 deferred=true';

  SELECT * INTO v_row FROM public.tw_bsr_sync_queue WHERE id = v_id;
  ASSERT v_row.status = 'pending',            format('Case A: status 應為 pending，實際 %s', v_row.status);
  ASSERT v_row.attempts = 2,                  format('Case A: attempts 應抵銷成 2，實際 %s', v_row.attempts);
  ASSERT v_row.last_error = 'quota_deferred', format('Case A: last_error 應為 quota_deferred，實際 %s', v_row.last_error);
  ASSERT v_row.started_at IS NULL,            'Case A: started_at 應清空';
  ASSERT v_row.next_run_at > now(),           'Case A: next_run_at 應延後到未來';
  ASSERT v_row.next_run_at <= now() + interval '31 min', 'Case A: 延後不應超過要求的 30 分';

  -- ---------------- Case B: attempts 抵銷不為負 ----------------
  UPDATE public.tw_bsr_sync_queue
     SET status = 'running', attempts = 0, started_at = now()
   WHERE id = v_id;
  PERFORM public.defer_bsr_job_quota(v_id, 15);
  SELECT * INTO v_row FROM public.tw_bsr_sync_queue WHERE id = v_id;
  ASSERT v_row.attempts = 0, format('Case B: attempts 不得為負，實際 %s', v_row.attempts);

  -- ---------------- Case C: 只對 running 生效 ----------------
  v_res := public.defer_bsr_job_quota(v_id, 30);   -- 此時已是 pending
  ASSERT (v_res->>'deferred')::boolean IS FALSE, 'Case C: 非 running 不應被 defer';
  ASSERT v_res->>'reason' = 'not_running',       'Case C: 應回報 not_running';

  DELETE FROM public.tw_bsr_sync_queue WHERE id = v_id;

  -- ---------------- Case D: recovery 硬上限 + 只挑 quota 類 ----------------
  v_ids := ARRAY[]::bigint[];
  FOR i IN 1..10 LOOP
    INSERT INTO public.tw_bsr_sync_queue
      (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
    VALUES (v_stock, v_date + i, 2, 'failed', 5, 5, 'finmind_admission_daily_exhausted', 'contract_test')
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  -- 一筆非 quota 類 failed：不得被復活
  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
  VALUES (v_stock, v_date + 50, 2, 'failed', 5, 5, 'no_chip_data', 'contract_test')
  RETURNING id INTO v_id;

  v_res := public.recover_quota_failed_bsr_jobs(3);
  ASSERT (v_res->>'recovered')::int = 3,
    format('Case D: 單輪 recovered 應等於 cap=3，實際 %s', v_res->>'recovered');

  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue
           WHERE id = ANY(v_ids) AND status = 'pending') = 3,
    'Case D: 應恰好 3 筆 quota-failed 轉 pending';

  ASSERT (SELECT status FROM public.tw_bsr_sync_queue WHERE id = v_id) = 'failed',
    'Case D: 非 quota 類 failed 不得被 recovery 碰到';

  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue
           WHERE id = ANY(v_ids) AND status = 'pending' AND max_attempts = 6) = 3,
    'Case D: 復活者應各拿到一枚 retry token（max_attempts 5 -> 6）';

  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue
           WHERE id = ANY(v_ids) AND status = 'pending' AND last_error = 'quota_recovery_token') = 3,
    'Case D: 復活者 last_error 應標記為 quota_recovery_token（可審計）';

  -- ---------------- Case E: retry token 用盡後不再復活 ----------------
  UPDATE public.tw_bsr_sync_queue
     SET status = 'failed', max_attempts = 8, last_error = 'finmind_admission_daily_exhausted'
   WHERE id = ANY(v_ids);

  v_res := public.recover_quota_failed_bsr_jobs(12);
  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue
           WHERE id = ANY(v_ids) AND status = 'pending') = 0,
    'Case E: max_attempts 已達 8 的工作不得再被復活';

  -- ---------------- Case F: cap=0 不復活但誠實回報 ----------------
  UPDATE public.tw_bsr_sync_queue
     SET status = 'failed', max_attempts = 5, last_error = 'finmind_admission_daily_exhausted'
   WHERE id = ANY(v_ids);

  v_res := public.recover_quota_failed_bsr_jobs(0);
  ASSERT (v_res->>'recovered')::int = 0,               'Case F: cap=0 不得復活任何一筆';
  ASSERT v_res->>'skipped_reason' = 'cap_zero',        'Case F: 應標記 skipped_reason=cap_zero';
  ASSERT (v_res->>'remaining')::int >= 10,             'Case F: remaining 應誠實含這 10 筆';

  RAISE NOTICE 'bsr_quota_recovery_test: ALL CASES PASSED';
END;
$t$;

ROLLBACK;
