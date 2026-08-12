-- Build 1c: exact-signature ACL convergence for the three BSR recovery functions.
-- NOTE (operational): these three functions currently carry explicit anon/authenticated
-- EXECUTE grants (grantor=postgres) that earlier "REVOKE ... FROM PUBLIC" statements did
-- not remove, because PUBLIC and named roles are distinct grantees. Any future DROP+CREATE
-- (i.e. a fresh object, not CREATE OR REPLACE) of these signatures MUST re-run the REVOKE
-- statements below and re-run the read-back matrix.
-- No function body is modified here; no global ALTER DEFAULT PRIVILEGES is touched.

REVOKE ALL ON FUNCTION public.bsr_backlog_metrics()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bsr_recovery_budget(integer)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bsr_backlog_metrics()                  TO service_role;
GRANT EXECUTE ON FUNCTION public.bsr_recovery_budget(integer)           TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Read-back: signature + security + ACL matrix (read-only asserts)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT p.provolatile, p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS ident
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bsr_backlog_metrics';
  ASSERT r.ident = '', 'bsr_backlog_metrics must stay zero-arg';
  ASSERT r.provolatile = 's' AND r.prosecdef, 'metrics: STABLE + SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'metrics: fixed search_path';

  SELECT p.provolatile, p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS ident
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='bsr_recovery_budget';
  ASSERT r.ident = 'p_full_budget integer', 'budget signature drift';
  ASSERT r.provolatile = 's' AND r.prosecdef, 'budget: STABLE + SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'budget: fixed search_path';

  SELECT p.provolatile, p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS ident
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='recover_quota_failed_bsr_jobs';
  ASSERT r.ident = 'p_max integer', 'recover signature drift';
  ASSERT r.provolatile = 'v' AND r.prosecdef, 'recover: VOLATILE + SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'recover: fixed search_path';
END $$;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon',          'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon',          'public.bsr_recovery_budget(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.bsr_recovery_budget(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon',          'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');

  ASSERT has_function_privilege('service_role', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.bsr_recovery_budget(integer)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('bsr_backlog_metrics','bsr_recovery_budget','recover_quota_failed_bsr_jobs')
       AND (array_to_string(p.proacl, ',') LIKE '%anon=%'
         OR array_to_string(p.proacl, ',') LIKE '%authenticated=%')
  ), 'proacl still lists anon/authenticated';
END $$;

-- ---------------------------------------------------------------------------
-- Tier B-readonly: metrics / budget JSON contract (positive read-only calls)
-- ---------------------------------------------------------------------------
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
  ASSERT (m#>>'{cohort,legacy_quota_failed_total}')::int
       = (m#>>'{cohort,satisfied_reconcilable}')::int
       + (m#>>'{cohort,actionable_still_required}')::int
       + (m#>>'{cohort,obsolete_retained}')::int,
       'cohort split must be exhaustive and disjoint';
END $$;

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