-- Build 1c Tier B-write — recover_quota_failed_bsr_jobs behaviour (EPHEMERAL DB ONLY)
--
-- production 永不執行本檔（連 rollback transaction 也不行）。
-- production 的 write path 由自然 cron job 106 的 data_source_refresh_logs
-- (source_key='bsr_quota_recovery') 證明，那是獨立的 Tier C gate，兩者不可互相冒充。
--
-- 執行方式（本機 / CI ephemeral Postgres）：
--   supabase db start
--   supabase db reset                       # 套用 supabase/migrations 全量
--   psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/bsr_recovery_write_test.sql
--
-- 目前 Lovable 環境沒有 ephemeral DB 通道 → 本層狀態為 PENDING，不得宣稱 PASS。
\set ON_ERROR_STOP on

-- Guard 1: never run against a hosted / production database.
SELECT (inet_server_addr() IS NOT NULL
        AND host(inet_server_addr()) NOT IN ('127.0.0.1','::1'))
       AS not_local \gset
\if :not_local
  \echo 'bsr_recovery_write_test: SKIPPED (non-ephemeral database) — PENDING, not PASS'
  DO $skip$ BEGIN RAISE EXCEPTION 'PENDING: non-ephemeral database, not a PASS'; END $skip$;
\endif

-- Guard 2: role must actually be able to execute the function.
SELECT NOT has_function_privilege(current_user,
         'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE') AS cannot_run \gset
\if :cannot_run
  \echo 'bsr_recovery_write_test: SKIPPED (insufficient role) — PENDING, not PASS'
  DO $skip$ BEGIN RAISE EXCEPTION 'PENDING: insufficient role, not a PASS'; END $skip$;
\endif

-- audit contract: exactly-once per invocation, honest keys
DO $$
DECLARE res jsonb; n int;
BEGIN
  res := public.recover_quota_failed_bsr_jobs(1);
  ASSERT res ? 'invocation_id' AND res ? 'tokens_issued' AND res ? 'reconciled'
     AND res ? 'budget_reason' AND res ? 'counting_mode';
  ASSERT (res->>'tokens_issued')::int <= 1 AND (res->>'reconciled')::int <= 1;

  SELECT count(*) INTO n FROM public.data_source_refresh_logs
   WHERE source_key = 'bsr_quota_recovery'
     AND metadata->>'invocation_id' = res->>'invocation_id';
  ASSERT n = 1, 'exactly one audit row per invocation';

  SELECT count(*) INTO n FROM public.data_source_refresh_logs
   WHERE source_key = 'bsr_quota_recovery'
     AND metadata->>'invocation_id' = res->>'invocation_id'
     AND status IN ('success','skipped')
     AND metadata ? 'metrics_before' AND metadata ? 'metrics_after'
     AND metadata ? 'budget_reason' AND metadata ? 'pools';
  ASSERT n = 1, 'audit row must carry reason + pool snapshot + before/after metrics';
  RAISE NOTICE 'recover result: %', res;
END $$;

\echo 'bsr_recovery_write_test: PASS'
