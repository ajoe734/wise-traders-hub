-- Whole-catalog ACL snapshot (aclitems sorted: grant order is not semantics) for the public schema: every relation and every
-- function, one canonical line each. Used to prove the H-ACL migration touches
-- only the planned signatures and that rollback is bit-identical.
SELECT 'REL|'||c.relname||'|'||coalesce((select string_agg(a::text,',' order by a::text) from unnest(c.relacl) a),'(default)')
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','v','m','S')
UNION ALL
SELECT 'FUN|public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'
       ||coalesce((select string_agg(a::text,',' order by a::text) from unnest(p.proacl) a),'(default)')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
UNION ALL
SELECT 'NSP|'||nspname||'|'||coalesce((select string_agg(a::text,',' order by a::text) from unnest(nspacl) a),'(default)')
FROM pg_namespace WHERE nspname IN ('public','extensions','app_ledger')
ORDER BY 1;
