-- Build 1 contract test runner（全部在子交易內執行並回滾，不留資料）
DO $outer$
DECLARE
  v_ok boolean := false;
  v_msg text;
BEGIN
  BEGIN
    DECLARE
      v_stock text := '9' || lpad((floor(random()*900)::int + 99)::text, 3, '0');
      v_date  date := current_date + 400;
      v_id    bigint;
      v_ids   bigint[] := ARRAY[]::bigint[];
      v_res   jsonb;
      v_row   public.tw_bsr_sync_queue;
      i       int;
    BEGIN
      -- Case A
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, attempts, max_attempts, started_at, next_run_at, enqueued_by)
      VALUES (v_stock, v_date, 2, 'running', 3, 5, now(), now(), 'contract_test')
      RETURNING id INTO v_id;

      v_res := public.defer_bsr_job_quota(v_id, 30);
      ASSERT (v_res->>'deferred')::boolean IS TRUE, 'Case A: deferred should be true';
      SELECT * INTO v_row FROM public.tw_bsr_sync_queue WHERE id = v_id;
      ASSERT v_row.status = 'pending', 'Case A: status should be pending';
      ASSERT v_row.attempts = 2, 'Case A: attempts should be 2';
      ASSERT v_row.last_error = 'quota_deferred', 'Case A: last_error mismatch';
      ASSERT v_row.started_at IS NULL, 'Case A: started_at should be null';
      ASSERT v_row.next_run_at > now(), 'Case A: next_run_at should be future';

      -- Case B
      UPDATE public.tw_bsr_sync_queue SET status='running', attempts=0, started_at=now() WHERE id=v_id;
      PERFORM public.defer_bsr_job_quota(v_id, 15);
      SELECT * INTO v_row FROM public.tw_bsr_sync_queue WHERE id = v_id;
      ASSERT v_row.attempts = 0, 'Case B: attempts must not go negative';

      -- Case C
      v_res := public.defer_bsr_job_quota(v_id, 30);
      ASSERT (v_res->>'deferred')::boolean IS FALSE, 'Case C: non-running must not defer';
      ASSERT v_res->>'reason' = 'not_running', 'Case C: reason mismatch';
      DELETE FROM public.tw_bsr_sync_queue WHERE id = v_id;

      -- Case D
      FOR i IN 1..10 LOOP
        INSERT INTO public.tw_bsr_sync_queue
          (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
        VALUES (v_stock, v_date + i, 2, 'failed', 5, 5, 'finmind_admission_daily_exhausted', 'contract_test')
        RETURNING id INTO v_id;
        v_ids := v_ids || v_id;
      END LOOP;

      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
      VALUES (v_stock, v_date + 50, 2, 'failed', 5, 5, 'no_chip_data', 'contract_test')
      RETURNING id INTO v_id;

      v_res := public.recover_quota_failed_bsr_jobs(3);
      ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue WHERE id = ANY(v_ids) AND status='pending') = 3,
        'Case D: exactly 3 should be recovered under cap';
      ASSERT (SELECT status FROM public.tw_bsr_sync_queue WHERE id = v_id) = 'failed',
        'Case D: non-quota failure must not be touched';
      ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue
               WHERE id = ANY(v_ids) AND status='pending' AND max_attempts=6) = 3,
        'Case D: retry token must bump max_attempts to 6';
      ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue
               WHERE id = ANY(v_ids) AND status='pending' AND last_error='quota_recovery_token') = 3,
        'Case D: recovered rows must be auditable';

      -- Case E
      UPDATE public.tw_bsr_sync_queue
         SET status='failed', max_attempts=8, last_error='finmind_admission_daily_exhausted'
       WHERE id = ANY(v_ids);
      PERFORM public.recover_quota_failed_bsr_jobs(12);
      ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue WHERE id = ANY(v_ids) AND status='pending') = 0,
        'Case E: exhausted retry tokens must not be recovered';

      -- Case F
      UPDATE public.tw_bsr_sync_queue
         SET status='failed', max_attempts=5, last_error='finmind_admission_daily_exhausted'
       WHERE id = ANY(v_ids);
      v_res := public.recover_quota_failed_bsr_jobs(0);
      ASSERT (v_res->>'recovered')::int = 0, 'Case F: cap=0 must recover nothing';
      ASSERT v_res->>'skipped_reason' = 'cap_zero', 'Case F: skipped_reason mismatch';
      ASSERT (v_res->>'remaining')::int >= 10, 'Case F: remaining must be honest';

      -- 全部通過後主動丟例外，讓子交易回滾（不留測試資料）
      RAISE EXCEPTION 'CONTRACT_TEST_PASSED';
    END;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    v_ok := (v_msg = 'CONTRACT_TEST_PASSED');
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'bsr_quota_recovery_test FAILED: %', v_msg;
  END IF;
  RAISE NOTICE 'bsr_quota_recovery_test: ALL 6 CASES PASSED (rolled back)';
END;
$outer$;