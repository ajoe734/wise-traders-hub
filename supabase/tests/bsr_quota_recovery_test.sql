-- Build 1b SQL contract: recovery / metrics functions
-- Run with: psql -f supabase/tests/bsr_quota_recovery_test.sql (service role / postgres)
\set ON_ERROR_STOP on

-- 1) signatures + volatility + security + search_path
DO $$
DECLARE r record;
BEGIN
  SELECT p.proname, p.provolatile, p.prosecdef, p.proconfig
    INTO r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bsr_backlog_metrics';
  ASSERT r.provolatile = 's', 'bsr_backlog_metrics must be STABLE';
  ASSERT r.prosecdef, 'bsr_backlog_metrics must be SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'fixed search_path required';

  SELECT p.proname, p.provolatile, p.prosecdef, p.proconfig
    INTO r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='recover_quota_failed_bsr_jobs';
  ASSERT r.provolatile = 'v', 'recover_quota_failed_bsr_jobs must be VOLATILE';
  ASSERT r.prosecdef, 'must be SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'fixed search_path required';
END $$;

-- 2) least privilege: no PUBLIC/anon/authenticated execute
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');
END $$;

-- 3) metrics shape: three separated buckets + split cohort counters
DO $$
DECLARE m jsonb;
BEGIN
  m := public.bsr_backlog_metrics();
  ASSERT m ? 'ready' AND m ? 'deferred' AND m ? 'cohort' AND m ? 'audit';
  ASSERT (m->'ready') ? 'oldest_due_since_h';
  ASSERT (m->'deferred') ? 'oldest_enqueued_age_h';
  ASSERT (m->'ready') ? 'unclaimable_null_count';
  ASSERT (m->'cohort') ? 'legacy_quota_failed_total';
  ASSERT (m->'cohort') ? 'actionable_still_required';
  ASSERT (m->'cohort') ? 'satisfied_reconcilable';
  ASSERT (m->'cohort') ? 'obsolete_retained';
  ASSERT (m#>>'{cohort,counting_mode}') = 'exact';
  -- split must add up
  ASSERT (m#>>'{cohort,legacy_quota_failed_total}')::int
       = (m#>>'{cohort,satisfied_reconcilable}')::int
       + (m#>>'{cohort,actionable_still_required}')::int
       + (m#>>'{cohort,obsolete_retained}')::int,
       'cohort split must be exhaustive and disjoint';
END $$;

-- 4) budget gates: kill switch / real degrade reason / pool reserve
DO $$
DECLARE b jsonb;
BEGIN
  b := public.bsr_recovery_budget(12);
  ASSERT b ? 'budget' AND b ? 'budget_reason' AND b ? 'pools' AND b ? 'degrade';
  ASSERT (b->>'budget')::int <= 1, 'canary cap is 1 token per invocation';
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(b->'pools') p
     WHERE p->>'pool' = 'interactive' AND (p->>'excluded')::boolean
  ), 'interactive pool must be excluded from recovery';
  ASSERT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(b->'pools') p
     WHERE (p->>'issue_ok')::boolean
       AND ((p->>'used_today')::int + 1 > (p->>'daily_budget')::int - 30
            OR (p->>'tokens')::int < 31)
  ), 'issue_ok must respect daily + burst reserve';
END $$;

-- 5) audit contract: exactly-once per invocation, honest keys
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

\echo 'bsr_quota_recovery_test: PASS'
