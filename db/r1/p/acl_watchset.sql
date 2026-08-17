-- =====================================================================
-- R1-P ACL WATCH SET — the single definition of "anon must not EXECUTE".
-- Runs identically on a read-only production session and on a clone.
-- Emits one line per violation:  <signature>|<class>
-- The watch set is:
--   (a) three named pre-cutover functions (security-sensitive helpers that
--       leak entitlement / capital state to an unauthenticated caller), and
--   (b) every admin / build / publish / backfill / dedupe / fix / rebuild /
--       sweep function in public + app_ledger (the C3 pattern family).
-- =====================================================================
WITH watch AS (
  SELECT p.oid,
         format('%I.%I(%s)', n.nspname, p.proname,
                pg_get_function_identity_arguments(p.oid)) AS sig,
         CASE
           WHEN p.proname IN ('get_expert_capital_status',
                              'has_active_subscription_after',
                              'is_tester') THEN 'named_pre_cutover'
           ELSE 'pattern_admin_build_publish'
         END AS class
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'app_ledger')
     AND p.prokind = 'f'
     AND (
       p.proname IN ('get_expert_capital_status',
                     'has_active_subscription_after',
                     'is_tester')
       OR p.proname LIKE 'admin\_%'
       OR p.proname LIKE 'canonical\_%'
       OR p.proname LIKE '%publish%'
       OR p.proname LIKE '%backfill%'
       OR p.proname LIKE '%dedupe%'
       OR p.proname LIKE '%fix%'
       OR p.proname LIKE '%rebuild%'
       OR p.proname LIKE '%sweep%'
     )
)
SELECT sig || '|' || class
  FROM watch
 WHERE has_function_privilege('anon', oid, 'EXECUTE')
 ORDER BY 1;
