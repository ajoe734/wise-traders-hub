-- Stage B fingerprint: catalog + queue/config data, stable ordering.
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

SELECT 'fn|'||p.oid::regprocedure||'|'||p.prosecdef::text||'|'||p.provolatile::text||'|'
       ||coalesce(array_to_string(p.proconfig,','),'-')||'|'
       ||coalesce(pg_get_userbyid(p.proowner),'-')||'|'
       ||md5(coalesce(array_to_string(p.proacl::text[],','),'-'))||'|'
       ||md5(pg_get_functiondef(p.oid))||'|cmt='
       ||coalesce(md5(obj_description(p.oid,'pg_proc')),'NULL')||'/'
       ||coalesce(length(obj_description(p.oid,'pg_proc'))::text,'0')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private_bsr') AND p.prokind='f'
 ORDER BY 1;

-- Replaced-function detail block. One line per CREATE OR REPLACE target that
-- pre-exists in the production baseline. Split into a metadata line (must be
-- invariant across apply AND rollback) and a body line (may differ after apply,
-- must be byte-identical again after rollback).
SELECT 'replmeta|'||p.oid::regprocedure
       ||'|ident='||pg_get_function_identity_arguments(p.oid)
       ||'|args='||pg_get_function_arguments(p.oid)
       ||'|result='||pg_get_function_result(p.oid)
       ||'|owner='||pg_get_userbyid(p.proowner)
       ||'|acl='||coalesce(p.proacl::text,'-')
       ||'|proconfig='||coalesce(array_to_string(p.proconfig,','),'-')
       ||'|provolatile='||p.provolatile::text
       ||'|prosecdef='||p.prosecdef::text
       ||'|proleakproof='||p.proleakproof::text
       ||'|prostrict='||p.proisstrict::text
       ||'|lang='||l.lanname
       ||'|comment_md5='||coalesce(md5(obj_description(p.oid,'pg_proc')),'NULL')
       ||'|comment_len='||coalesce(length(obj_description(p.oid,'pg_proc'))::text,'0')
       ||'|comment_text='||coalesce(replace(obj_description(p.oid,'pg_proc'), E'\n', '\n'),'NULL')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public'
   AND p.proname IN ('recover_quota_failed_bsr_jobs','recover_stale_bsr_queue_jobs','reap_stale_bsr_queue_jobs')
 ORDER BY 1;

SELECT 'replbody|'||p.oid::regprocedure||'|'||md5(pg_get_functiondef(p.oid))
       ||'|len='||length(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('recover_quota_failed_bsr_jobs','recover_stale_bsr_queue_jobs','reap_stale_bsr_queue_jobs')
 ORDER BY 1;


SELECT 'trg|'||c.relname||'|'||t.tgname||'|'||t.tgenabled::text||'|'||md5(pg_get_triggerdef(t.oid))
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
