-- Baseline-only fingerprint. Every S1-min creation is excluded by name, so a
-- correct additive apply AND a correct stage rollback must both reproduce the
-- pre-S1 value exactly, including the physical relfilenode of baseline tables.
SELECT 'baseline_relfilenode|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||c.relname||':'||c.relfilenode FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','m')
   AND c.relname NOT IN('public_projection_version','public_projection_withheld'))s(x);
SELECT 'economic|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT id::text||':'||expert_id::text||':'||instrument||':'||quantity::text||':'||status::text FROM public.trade_records
 UNION ALL SELECT id::text||':'||expert_id::text||':'||instrument||':'||coalesce(quantity::text,'')||':'||status::text FROM public.expert_signals)s(x);
SELECT 'public_acl|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||coalesce(p.proacl::text,'')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')s(x);
SELECT 'public_table_acl|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||c.relname||'|'||coalesce(c.relacl::text,'')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','m','v','S')
   AND c.relname NOT IN('public_projection_version','public_projection_withheld'))s(x);
SELECT 'legacy_writer_contract|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT p.proname||'|'||md5(p.prosrc)||'|'||p.prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public')s(x);
SELECT 'baseline_triggers|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT c.relname||'.'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public')s(x);
SELECT 'baseline_roles|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT rolname||':'||rolsuper::text||':'||rolbypassrls::text||':'||rolcanlogin::text
 FROM pg_roles WHERE rolname <> 'ledger_owner')s(x);
