-- Build 1d Tier B-write — recover_quota_failed_bsr_jobs 行為契約（EPHEMERAL DB ONLY）
--
-- production 永不執行本檔（連 rollback transaction 也不行）。
-- production 的 write path 由自然 cron job 106 的 data_source_refresh_logs
-- (source_key='bsr_quota_recovery') 證明，那是獨立的 Tier C gate，兩者不可互相冒充。
--
-- 執行方式（本機臨時 cluster，見 scripts/ephemeral-pg.sh）：
--   bash scripts/ephemeral-pg.sh up
--   bash scripts/ephemeral-pg.sh migrate
--   bash scripts/ephemeral-pg.sh test
--   bash scripts/ephemeral-pg.sh test --negative-control   # 期望 exit != 0
--   bash scripts/ephemeral-pg.sh down
--
-- 直接呼叫時的 exact command（GUC 由 PGOPTIONS 注入，不是 psql -v）：
--   PGOPTIONS='-c bsr.ephemeral=1' psql -h /tmp/bsr-eph-<pid>-pg17 -U postgres \
--     -d bsr_ephemeral -X -v ON_ERROR_STOP=1 -v negative_control=0 \
--     -f supabase/tests/bsr_recovery_write_test.sql

\set ON_ERROR_STOP on
\set negative_control 0

-- ---------------------------------------------------------------------------
-- Guard：任一不符即中止（hard fail，不 SKIP）
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE v_roles int; v_q int; v_f int; v_l int;
BEGIN
  ASSERT COALESCE(current_setting('bsr.ephemeral', true), '') = '1',
         'guard: bsr.ephemeral GUC not set to 1 (use PGOPTIONS)';
  ASSERT inet_server_addr() IS NULL,
         'guard: not a unix-socket connection';
  ASSERT current_setting('unix_socket_directories') LIKE '/tmp/bsr-eph-%',
         'guard: unexpected socket dir ' || current_setting('unix_socket_directories');
  ASSERT current_database() = 'bsr_ephemeral', 'guard: wrong database ' || current_database();
  ASSERT current_user = 'postgres', 'guard: wrong user ' || current_user;

  SELECT count(*) INTO v_roles FROM pg_roles
   WHERE rolname IN ('supabase_admin','supabase_auth_admin','authenticator');
  ASSERT v_roles = 0, 'guard: production role fingerprint detected';

  SELECT count(*) INTO v_q FROM public.tw_bsr_sync_queue;
  SELECT count(*) INTO v_f FROM public.tw_chip_fact;
  SELECT count(*) INTO v_l FROM public.data_source_refresh_logs WHERE source_key = 'bsr_quota_recovery';
  ASSERT v_q = 0 AND v_f = 0 AND v_l = 0,
         format('guard: database not pristine (queue=%s fact=%s logs=%s)', v_q, v_f, v_l);

  RAISE NOTICE 'guard OK: db=% user=% addr=% sock=%',
    current_database(), current_user, inet_server_addr(), current_setting('unix_socket_directories');
END
$guard$;

-- ---------------------------------------------------------------------------
-- Case A — terminal reconcile，零 token（獨立 transaction）
-- ---------------------------------------------------------------------------
\echo '--- Case A: terminal reconcile ---'
BEGIN;
DO $caseA$
DECLARE
  v_d date; v_id bigint; v_res jsonb; v_m jsonb; n int;
  v_status text; v_err text; v_max int; v_touched int;
BEGIN
  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue) = 0, 'A: residue in queue';
  ASSERT (SELECT count(*) FROM public.tw_chip_fact) = 0, 'A: residue in fact';

  INSERT INTO public.finmind_quota_pools (pool_name, tokens, used_today, daily_budget, reset_at)
  VALUES ('backfill', 600, 0, 600, 16), ('keepwarm', 0, 400, 400, 16), ('interactive', 0, 240, 240, 16)
  ON CONFLICT (pool_name) DO UPDATE
    SET tokens = EXCLUDED.tokens, used_today = EXCLUDED.used_today, daily_budget = EXCLUDED.daily_budget;

  INSERT INTO public.system_kill_switches (key, enabled) VALUES ('chips_all', true)
  ON CONFLICT (key) DO UPDATE SET enabled = true;   -- enabled=true 代表「允許執行」（kill switch 未啟動）

  v_d := public.expected_latest_bsr_date();

  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
  VALUES ('ZZ9001', v_d, 1, 'failed', 5, 5, 'finmind_admission_daily', 'build1d_test')
  RETURNING id INTO v_id;

  INSERT INTO public.tw_chip_fact (stock_id, trade_date, broker_id, source, buy_shares, sell_shares)
  VALUES ('ZZ9001', v_d, '9999', 'build1d_test', 1000, 0);

  -- 前置條件：只有 satisfied 候選，沒有任何 actionable 候選 → tokens=0 是結構保證
  v_m := public.bsr_backlog_metrics();
  ASSERT (v_m#>>'{cohort,satisfied_reconcilable}')::int = 1,
         'A precondition: satisfied_reconcilable must be 1, got ' || (v_m#>>'{cohort,satisfied_reconcilable}');
  ASSERT (v_m#>>'{cohort,actionable_still_required}')::int = 0, 'A precondition: still_required must be 0';
  ASSERT (v_m#>>'{cohort,actionable_token_eligible}')::int = 0, 'A precondition: token_eligible must be 0';

  v_res := public.recover_quota_failed_bsr_jobs(1);
  RAISE NOTICE 'A result: %', v_res;

  ASSERT (v_res->>'reconciled')::int = 1, 'A: reconciled must be 1';
  ASSERT (v_res->>'tokens_issued')::int = 0, 'A: tokens_issued must be 0';
  ASSERT v_res->'reconciled_job_ids' = jsonb_build_array(v_id), 'A: reconciled_job_ids mismatch';
  ASSERT v_res->'tokened_job_ids' = '[]'::jsonb, 'A: tokened_job_ids must be empty';

  SELECT status, last_error, max_attempts INTO v_status, v_err, v_max
    FROM public.tw_bsr_sync_queue WHERE id = v_id;
  ASSERT v_status = 'done', 'A: status must be done, got ' || v_status;
  ASSERT v_err = 'reconciled_fact_exists', 'A: last_error must be reconciled_fact_exists, got ' || v_err;
  ASSERT v_max = 5, 'A: max_attempts must stay 5, got ' || v_max;

  SELECT count(*) INTO v_touched FROM public.tw_bsr_sync_queue
   WHERE id <> v_id AND updated_at > created_at;
  ASSERT v_touched = 0, 'A: cohort-external churn detected';

  SELECT count(*) INTO n FROM public.data_source_refresh_logs
   WHERE source_key = 'bsr_quota_recovery'
     AND metadata->>'invocation_id' = v_res->>'invocation_id'
     AND metadata ? 'metrics_before' AND metadata ? 'metrics_after'
     AND metadata ? 'budget_reason' AND metadata ? 'pools';
  ASSERT n = 1, 'A: exactly one complete audit row per invocation, got ' || n;

  RAISE NOTICE 'A audit: invocation=% job=% budget_reason=%',
    v_res->>'invocation_id', v_id, v_res->>'budget_reason';
END
$caseA$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Case B — still-required 至多一 token（獨立 transaction）
-- ---------------------------------------------------------------------------
\echo '--- Case B: still-required single token ---'
BEGIN;
DO $caseB$
DECLARE
  v_d date; v_id bigint; v_res jsonb; v_m jsonb; v_b jsonb; n int;
  v_status text; v_err text; v_max int; v_next timestamptz;
  v_started timestamptz; v_finished timestamptz; v_touched int;
BEGIN
  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue) = 0, 'B: residue in queue (rollback failed)';
  ASSERT (SELECT count(*) FROM public.tw_chip_fact) = 0, 'B: residue in fact (rollback failed)';

  INSERT INTO public.finmind_quota_pools (pool_name, tokens, used_today, daily_budget, reset_at)
  VALUES ('backfill', 600, 0, 600, 16), ('keepwarm', 0, 400, 400, 16), ('interactive', 0, 240, 240, 16)
  ON CONFLICT (pool_name) DO UPDATE
    SET tokens = EXCLUDED.tokens, used_today = EXCLUDED.used_today, daily_budget = EXCLUDED.daily_budget;

  INSERT INTO public.system_kill_switches (key, enabled) VALUES ('chips_all', true)
  ON CONFLICT (key) DO UPDATE SET enabled = true;

  v_d := public.expected_latest_bsr_date();

  -- priority 3 → pool 'backfill'（body 的分類：<=1 interactive / =2 keepwarm / else backfill）
  -- trade_date = expected_latest_bsr_date() → actionable 條件第一支直接成立，
  -- 因此不需要任何 readiness/have5 或 universe 資料。
  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
  VALUES ('ZZ9002', v_d, 3, 'failed', 5, 5, 'finmind_admission_daily', 'build1d_test')
  RETURNING id INTO v_id;

  v_m := public.bsr_backlog_metrics();
  ASSERT (v_m#>>'{cohort,actionable_token_eligible}')::int = 1,
         'B precondition: token_eligible must be 1, got ' || (v_m#>>'{cohort,actionable_token_eligible}');
  ASSERT (v_m#>>'{cohort,satisfied_reconcilable}')::int = 0, 'B precondition: satisfied must be 0';

  v_b := public.bsr_recovery_budget(1);
  ASSERT v_b->>'budget_reason' = 'cap_1', 'B precondition: budget_reason must be cap_1, got ' || (v_b->>'budget_reason');
  ASSERT (v_b->>'budget')::int = 1, 'B precondition: budget must be 1';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_b->'pools') p
                  WHERE p->>'pool' = 'backfill' AND (p->>'issue_ok')::boolean),
         'B precondition: backfill pool must be issue_ok';

  v_res := public.recover_quota_failed_bsr_jobs(1);
  RAISE NOTICE 'B result: %', v_res;

  ASSERT (v_res->>'tokens_issued')::int = 1, 'B: tokens_issued must be 1';
  ASSERT (v_res->>'reconciled')::int = 0, 'B: reconciled must be 0';
  ASSERT v_res->'tokened_job_ids' = jsonb_build_array(v_id), 'B: tokened_job_ids mismatch';

  SELECT status, last_error, max_attempts, next_run_at, started_at, finished_at
    INTO v_status, v_err, v_max, v_next, v_started, v_finished
    FROM public.tw_bsr_sync_queue WHERE id = v_id;
  ASSERT v_status = 'pending', 'B: status must be pending, got ' || v_status;
  ASSERT v_err = 'quota_recovery_token', 'B: last_error must be quota_recovery_token, got ' || v_err;
  ASSERT v_max = 6, 'B: max_attempts must be 6, got ' || v_max;
  ASSERT v_next <= now(), 'B: next_run_at must be due now';
  ASSERT v_started IS NULL AND v_finished IS NULL, 'B: started_at/finished_at must be reset';

  SELECT count(*) INTO v_touched FROM public.tw_bsr_sync_queue
   WHERE id <> v_id AND updated_at > created_at;
  ASSERT v_touched = 0, 'B: cohort-external churn detected';

  SELECT count(*) INTO n FROM public.data_source_refresh_logs
   WHERE source_key = 'bsr_quota_recovery'
     AND metadata->>'invocation_id' = v_res->>'invocation_id'
     AND metadata ? 'metrics_before' AND metadata ? 'metrics_after'
     AND metadata ? 'budget_reason' AND metadata ? 'pools';
  ASSERT n = 1, 'B: exactly one complete audit row per invocation, got ' || n;

  RAISE NOTICE 'B audit: invocation=% job=% budget_reason=%',
    v_res->>'invocation_id', v_id, v_res->>'budget_reason';
END
$caseB$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Case C — advisory lock 競爭下的原子性（背景 session 由 harness 持鎖）
-- 只有 normal 模式跑（negative control 不需要）。
-- ---------------------------------------------------------------------------
\if :negative_control
\else
\echo '--- Case C: advisory lock contention ---'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $caseC$
DECLARE v_d date; v_id bigint; v_res jsonb; n int; v_status text; v_snapshot text;
BEGIN
  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue) = 0, 'C: residue in queue';
  ASSERT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 771001 AND granted),
         'C: expected an external session to hold advisory lock 771001';

  v_d := public.expected_latest_bsr_date();
  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
  VALUES ('ZZ9003', v_d, 3, 'failed', 5, 5, 'finmind_admission_daily', 'build1d_test')
  RETURNING id INTO v_id;
  SELECT status || '|' || last_error || '|' || max_attempts INTO v_snapshot
    FROM public.tw_bsr_sync_queue WHERE id = v_id;

  v_res := public.recover_quota_failed_bsr_jobs(1);
  RAISE NOTICE 'C result: %', v_res;

  ASSERT v_res->>'budget_reason' = 'lock_contended',
         'C: budget_reason must be lock_contended, got ' || (v_res->>'budget_reason');
  ASSERT (v_res->>'tokens_issued')::int = 0, 'C: tokens_issued must be 0';
  ASSERT (v_res->>'reconciled')::int = 0, 'C: reconciled must be 0';

  ASSERT (SELECT status || '|' || last_error || '|' || max_attempts
            FROM public.tw_bsr_sync_queue WHERE id = v_id) = v_snapshot,
         'C: queue row must be untouched';

  SELECT count(*), max(status) INTO n, v_status FROM public.data_source_refresh_logs
   WHERE source_key = 'bsr_quota_recovery'
     AND metadata->>'invocation_id' = v_res->>'invocation_id';
  ASSERT n = 1, 'C: exactly one audit row, got ' || n;
  ASSERT v_status = 'skipped', 'C: audit status must be skipped, got ' || v_status;

  RAISE NOTICE 'C audit: invocation=% job=% status=skipped', v_res->>'invocation_id', v_id;
END
$caseC$;
ROLLBACK;
\endif

-- ---------------------------------------------------------------------------
-- Negative control — 獨立 transaction、獨立 fixture、故意讓斷言不成立
-- ---------------------------------------------------------------------------
\if :negative_control
\echo '--- Negative control: expecting FAILURE ---'
BEGIN;
DO $neg$
DECLARE v_d date; v_id bigint; v_res jsonb;
BEGIN
  ASSERT (SELECT count(*) FROM public.tw_bsr_sync_queue) = 0, 'NC: residue in queue';

  INSERT INTO public.finmind_quota_pools (pool_name, tokens, used_today, daily_budget, reset_at)
  VALUES ('backfill', 600, 0, 600, 16), ('keepwarm', 0, 400, 400, 16), ('interactive', 0, 240, 240, 16)
  ON CONFLICT (pool_name) DO UPDATE
    SET tokens = EXCLUDED.tokens, used_today = EXCLUDED.used_today, daily_budget = EXCLUDED.daily_budget;

  v_d := public.expected_latest_bsr_date();
  -- 與 Case A 相同的 queue 列，但故意不插 tw_chip_fact → reconcile 不可能發生
  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, attempts, max_attempts, last_error, enqueued_by)
  VALUES ('ZZ9001', v_d, 1, 'failed', 5, 5, 'finmind_admission_daily', 'build1d_negative')
  RETURNING id INTO v_id;

  v_res := public.recover_quota_failed_bsr_jobs(1);
  RAISE NOTICE 'NC result: %', v_res;
  ASSERT (v_res->>'reconciled')::int = 1,
         'NEGATIVE CONTROL: harness must fail here (reconciled was ' || (v_res->>'reconciled') || ')';
END
$neg$;
ROLLBACK;
\echo 'negative control did NOT fail — harness is broken'
\quit
\endif

\echo 'bsr_recovery_write_test: PASS'
