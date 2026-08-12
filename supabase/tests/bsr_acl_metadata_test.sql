-- Build 1c Tier A — catalog / ACL contract (no function invocation)
-- Runs on any connection that can read pg_catalog, including the restricted sandbox role:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/bsr_acl_metadata_test.sql
\set ON_ERROR_STOP on

-- 1) signatures + volatility + security + search_path
DO $$
DECLARE r record;
BEGIN
  SELECT p.provolatile, p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS ident
    INTO r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bsr_backlog_metrics';
  ASSERT r.ident = '', 'bsr_backlog_metrics must stay zero-arg';
  ASSERT r.provolatile = 's', 'bsr_backlog_metrics must be STABLE';
  ASSERT r.prosecdef, 'bsr_backlog_metrics must be SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'fixed search_path required';

  SELECT p.provolatile, p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS ident
    INTO r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bsr_recovery_budget';
  ASSERT r.ident = 'p_full_budget integer', 'bsr_recovery_budget signature drift';
  ASSERT r.provolatile = 's', 'bsr_recovery_budget must be STABLE';
  ASSERT r.prosecdef, 'must be SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'fixed search_path required';

  SELECT p.provolatile, p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS ident
    INTO r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='recover_quota_failed_bsr_jobs';
  ASSERT r.ident = 'p_max integer', 'recover_quota_failed_bsr_jobs signature drift';
  ASSERT r.provolatile = 'v', 'recover_quota_failed_bsr_jobs must be VOLATILE';
  ASSERT r.prosecdef, 'must be SECURITY DEFINER';
  ASSERT r.proconfig @> ARRAY['search_path=public'], 'fixed search_path required';
END $$;

-- 2) least privilege: no PUBLIC / anon / authenticated execute; service_role keeps it
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.bsr_recovery_budget(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.bsr_recovery_budget(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');

  ASSERT has_function_privilege('service_role', 'public.bsr_backlog_metrics()', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.bsr_recovery_budget(integer)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.recover_quota_failed_bsr_jobs(integer)', 'EXECUTE');
END $$;

-- 3) raw ACL must not list anon / authenticated at all (has_function_privilege alone
--    would also pass if PUBLIC were granted, so assert the catalog text too)
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('bsr_backlog_metrics','bsr_recovery_budget','recover_quota_failed_bsr_jobs')
       AND (array_to_string(p.proacl, ',') LIKE '%anon=%'
         OR array_to_string(p.proacl, ',') LIKE '%authenticated=%'
         OR array_to_string(p.proacl, ',') LIKE '%=X/%' AND array_to_string(p.proacl, ',') LIKE '%,=%')
  ), 'proacl must not grant anon / authenticated / PUBLIC';
END $$;

\echo 'bsr_acl_metadata_test: PASS'
