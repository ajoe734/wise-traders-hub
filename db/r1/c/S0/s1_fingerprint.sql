-- Only pre-existing production objects/data/ACL: S1 additions are deliberately excluded.
SELECT 'relfilenode|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||c.relname||':'||c.relfilenode FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','m')
   AND c.relname NOT IN('public_projection_version','public_projection_withheld'))s(x);
SELECT 'economic|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT id::text||':'||expert_id::text||':'||instrument||':'||quantity::text||':'||status::text FROM public.trade_records
 UNION ALL SELECT id::text||':'||expert_id::text||':'||instrument||':'||coalesce(quantity::text,'')||':'||status::text FROM public.expert_signals)s(x);
SELECT 'public_acl|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||coalesce(p.proacl::text,'')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')s(x);
SELECT 'legacy_writer_contract|'||md5(string_agg(x,E'\n' order by x)) FROM (
 SELECT p.proname||'|'||md5(p.prosrc)||'|'||p.prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('handle_signal_trade','save_signal_batch','recall_signal','delete_trade_record','delete_expert_signal'))s(x);