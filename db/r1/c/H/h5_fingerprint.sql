-- Baseline fingerprint for the H5 read-only proof.
-- The only object H5 creates (public.get_chips_detail_ro) is excluded by name,
-- so apply / read / rollback must all reproduce the identical value.
SELECT 'baseline_relfilenode|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||c.relname||':'||c.relfilenode FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','m'))s(x);
SELECT 'baseline_function_acl|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||coalesce(p.proacl::text,'')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname <> 'get_chips_detail_ro')s(x);
SELECT 'baseline_table_acl|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||c.relname||'|'||coalesce(c.relacl::text,'')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','m','v','S'))s(x);
SELECT 'writer_contract|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT p.proname||'|'||md5(p.prosrc)||'|'||p.prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname <> 'get_chips_detail_ro')s(x);
SELECT 'baseline_triggers|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT c.relname||'.'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public')s(x);
SELECT 'chips_data_hash|'||md5(coalesce(string_agg(x,E'\n' order by x),'')) FROM (
 SELECT 'q:'||id::text||stock_id||trade_date::text||status||attempts::text FROM public.tw_bsr_sync_queue
 UNION ALL SELECT 'a:'||id::text||stock_id||trade_date::text||outcome FROM public.tw_bsr_attempt_logs
 UNION ALL SELECT 'r:'||id::text||stock_id||as_of_date::text||window_days::text||foreign_net::text||trust_net::text
                  ||dealer_net::text||bsr_available::text||updated_at::text FROM public.tw_chips_rollup
 UNION ALL SELECT 'c:'||stock_id||trade_date::text||broker_count::text||broker_sum_shares::text
                  ||coalesce(coverage_pct::text,'')||coverage_class||computed_at::text FROM public.bsr_coverage_daily
 UNION ALL SELECT 'd:'||id::text||stock_id||trade_date::text||broker_id||net_shares::text FROM public.tw_bsr_daily
 UNION ALL SELECT 'p:'||code||source||active::text||supported::text||updated_at::text FROM public.chips_prefetch_targets
)s(x);
SELECT 'chips_rowcounts|'||(SELECT count(*) FROM public.tw_bsr_sync_queue)||':'
       ||(SELECT count(*) FROM public.tw_bsr_attempt_logs)||':'
       ||(SELECT count(*) FROM public.tw_chips_rollup)||':'
       ||(SELECT count(*) FROM public.bsr_coverage_daily)||':'
       ||(SELECT count(*) FROM public.tw_bsr_daily)||':'
       ||(SELECT count(*) FROM public.chips_prefetch_targets);
SELECT 'chips_max_updated|'||coalesce((SELECT max(updated_at)::text FROM public.tw_chips_rollup),'-')||':'
       ||coalesce((SELECT max(computed_at)::text FROM public.bsr_coverage_daily),'-')||':'
       ||coalesce((SELECT max(updated_at)::text FROM public.tw_bsr_sync_queue),'-')||':'
       ||coalesce((SELECT max(attempted_at)::text FROM public.tw_bsr_attempt_logs),'-');
