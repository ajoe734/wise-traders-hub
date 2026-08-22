\pset format unaligned
\pset fieldsep ' | '
select 'ts', now();
select 'queue_count', count(*) from public.tw_bsr_sync_queue;
select 'queue_hash', md5(string_agg(id||':'||status||':'||updated_at, ',' order by id)) from public.tw_bsr_sync_queue;
select 'queue_max_updated', max(updated_at)::text, 'queue_max_enqueued', max(enqueued_at)::text from public.tw_bsr_sync_queue;
select 'status', status, count(*) from public.tw_bsr_sync_queue group by 1,2 order by 2;
select 'config_hash', md5(string_agg(key||':'||version||':'||md5(config::text), ',' order by key)) from public.tw_bsr_sync_config;
select 'config_row', key, version, md5(config::text) from public.tw_bsr_sync_config order by key;
select 'audit_logs', count(*) from public.audit_logs;
select 'degrade_events', count(*) from public.tw_bsr_degrade_events;
select 'recovery_stale_candidates', count(*), coalesce(md5(string_agg(id::text, ',' order by id)),'-')
  from public.tw_bsr_sync_queue q where q.status in ('failed','skipped') and q.attempts < least(q.max_attempts,5);
select 'recovery_quota_candidates', count(*), coalesce(md5(string_agg(id::text, ',' order by id)),'-')
  from public.tw_bsr_sync_queue q where q.status='failed' and (q.last_error like 'finmind_admission_%' or q.last_error='quota_deferred');
select 'fn', p.oid::regprocedure::text, pg_get_function_result(p.oid), p.prosecdef::text, p.provolatile,
       coalesce(p.proconfig::text,'-'), coalesce(p.proacl::text,'(default)'), md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('enqueue_chips_prefetch_gaps','enqueue_all_active_tw_holdings_bsr','enqueue_bsr_first_fetch_on_trade','ensure_bsr_queued','enqueue_bsr_backfill','recover_stale_bsr_queue_jobs','recover_quota_failed_bsr_jobs'))
    or (n.nspname='private_bsr' and p.proname='ingest_allowed')
 order by 2;
select 'public_create', r, has_schema_privilege(r,'public','CREATE')::text from unnest(array['anon','authenticated','service_role']) r;
select 'private_bsr_usage', r, has_schema_privilege(r,'private_bsr','USAGE')::text from unnest(array['anon','authenticated','service_role']) r;
