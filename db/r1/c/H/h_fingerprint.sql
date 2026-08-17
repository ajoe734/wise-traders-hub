-- Baseline fingerprint for the H0/H1/H2 additive proof.
-- Every object H creates is excluded by name, so apply and rollback must both
-- reproduce the pre-H value exactly, including relfilenode of baseline tables.
SELECT 'baseline_relfilenode|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||c.relname||':'||c.relfilenode FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','m')
   AND c.relname NOT IN('tw_market_symbols','symbol_demand_registry'))s(x);
SELECT 'economic|'||md5(coalesce(string_agg(x,E'\n' order by x),'')) FROM (
 SELECT id::text||':'||instrument||':'||quantity::text||':'||status::text FROM public.trade_records)s(x);
SELECT 'public_function_acl|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||coalesce(p.proacl::text,'')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname NOT IN('cleanup_old_edge_boot_events','cleanup_old_bsr_attempt_logs','cleanup_old_cron_dispatch_log',
                        'upsert_tw_market_symbols','tw_market_symbols_touch','register_symbol_demand','decay_symbol_demand'))s(x);
SELECT 'public_table_acl|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||c.relname||'|'||coalesce(c.relacl::text,'')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','m','v','S')
   AND c.relname NOT IN('tw_market_symbols','symbol_demand_registry','freshness_run_trace'))s(x);
SELECT 'writer_contract|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT p.proname||'|'||md5(p.prosrc)||'|'||p.prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname NOT IN('cleanup_old_edge_boot_events','cleanup_old_bsr_attempt_logs','cleanup_old_cron_dispatch_log',
                        'upsert_tw_market_symbols','tw_market_symbols_touch','register_symbol_demand','decay_symbol_demand'))s(x);
SELECT 'baseline_triggers|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT c.relname||'.'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public'
   AND c.relname NOT IN('tw_market_symbols'))s(x);
SELECT 'baseline_roles|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT rolname||':'||rolsuper::text||':'||rolbypassrls::text||':'||rolcanlogin::text FROM pg_roles)s(x);
SELECT 'baseline_log_rowcounts|'||(SELECT count(*) FROM public.edge_boot_events)||':'
       ||(SELECT count(*) FROM public.tw_bsr_attempt_logs)||':'||(SELECT count(*) FROM public.cron_dispatch_log);
