-- R1-D: catalog + economic-data fingerprint. Used for rollback before=after proof.
\pset tuples_only on
\pset format unaligned
SELECT 'catalog.tables|'||md5(string_agg(x,E'\n' ORDER BY x)) FROM (
  SELECT n.nspname||'.'||c.relname||':'||c.relkind||':'||pg_get_userbyid(c.relowner)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','app_ledger','auth')) s(x);
SELECT 'catalog.columns|'||md5(string_agg(x,E'\n' ORDER BY x)) FROM (
  SELECT table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable
    FROM information_schema.columns WHERE table_schema IN ('public','app_ledger')) s(x);
SELECT 'catalog.functions|'||md5(string_agg(x,E'\n' ORDER BY x)) FROM (
  SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'
         ||pg_get_userbyid(p.proowner)||':'||p.prosecdef::text||':'||md5(p.prosrc)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','app_ledger')) s(x);
SELECT 'catalog.triggers|'||md5(string_agg(x,E'\n' ORDER BY x)) FROM (
  SELECT c.relname||'.'||tg.tgname||':'||tg.tgenabled||':'||md5(pg_get_triggerdef(tg.oid))
    FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT tg.tgisinternal AND n.nspname IN ('public','app_ledger')) s(x);
SELECT 'catalog.acl|'||md5(string_agg(x,E'\n' ORDER BY x)) FROM (
  SELECT n.nspname||'.'||c.relname||':'||coalesce(c.relacl::text,'')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','app_ledger') AND c.relkind IN ('r','p','v','S')) s(x);
SELECT 'catalog.roles|'||md5(string_agg(x,E'\n' ORDER BY x)) FROM (
  SELECT rolname||':'||rolcanlogin::text||':'||rolsuper::text||':'||rolbypassrls::text
    FROM pg_roles WHERE rolname NOT LIKE 'pg\_%') s(x);
SELECT 'data.trade_records|'||coalesce(md5(string_agg(x,E'\n' ORDER BY x)),'empty') FROM (
  SELECT id::text||':'||expert_id::text||':'||instrument||':'||quantity::text||':'
         ||coalesce(quantity_unit,'')||':'||status::text
    FROM public.trade_records) s(x);
SELECT 'data.expert_signals|'||coalesce(md5(string_agg(x,E'\n' ORDER BY x)),'empty') FROM (
  SELECT id::text||':'||coalesce(quantity::text,'')||':'||status::text
    FROM public.expert_signals) s(x);
SELECT 'data.counts|trade_records='||(SELECT count(*) FROM public.trade_records)
       ||',expert_signals='||(SELECT count(*) FROM public.expert_signals)
       ||',experts='||(SELECT count(*) FROM public.experts);
\pset tuples_only off
