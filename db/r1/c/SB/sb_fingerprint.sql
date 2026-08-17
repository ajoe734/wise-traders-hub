-- Stage B fingerprint: catalog + queue/config data, stable ordering.
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

SELECT 'fn|'||p.oid::regprocedure||'|'||p.prosecdef||'|'||p.provolatile||'|'
       ||coalesce(array_to_string(p.proconfig,','),'-')||'|'
       ||coalesce(pg_get_userbyid(p.proowner),'-')||'|'
       ||md5(coalesce(array_to_string(p.proacl::text[],','),'-'))||'|'
       ||md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private_bsr')
 ORDER BY 1;

SELECT 'trg|'||c.relname||'|'||t.tgname||'|'||t.tgenabled||'|'||md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname='public'
 ORDER BY 1;

SELECT 'nsp|'||n.nspname||'|'||md5(coalesce(n.nspacl::text,'-'))
  FROM pg_namespace n WHERE n.nspname IN ('public','private_bsr') ORDER BY 1;

SELECT 'data|tw_bsr_sync_queue|'||count(*)||'|'
       ||md5(coalesce(string_agg(id||':'||status||':'||attempts||':'||coalesce(last_error,'-')
             ||':'||coalesce(started_at::text,'-')||':'||coalesce(next_run_at::text,'-'), ',' ORDER BY id),'-'))
  FROM public.tw_bsr_sync_queue;

SELECT 'data|tw_bsr_sync_config|'||count(*)||'|'
       ||md5(coalesce(string_agg(key||':'||version||':'||config::text, ',' ORDER BY key),'-'))
  FROM public.tw_bsr_sync_config;

SELECT 'data|audit_logs|'||count(*) FROM public.audit_logs;
SELECT 'data|tw_bsr_degrade_events|'||count(*) FROM public.tw_bsr_degrade_events;
SELECT 'data|data_source_refresh_logs|'||count(*) FROM public.data_source_refresh_logs;
SELECT 'data|tw_chip_fact|'||count(*) FROM public.tw_chip_fact;
