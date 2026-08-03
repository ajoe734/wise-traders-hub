-- FinMind 回填 pipeline 二輪修復（forward-only、idempotent）
-- 1) cron call_budget 12 → 8（logical 上限 10；每 call 最多 3 次 HTTP attempts → 最壞 24 < 30/hour）
DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN
    SELECT * FROM (VALUES
      ('backfill-gap-orchestrator-sunday',
       '0 10 * * 0',
       $cmd$SELECT public.cron_edge_call('backfill-gap-orchestrator', '{"mode":"run","max_scan_jobs":1000,"max_dispatch_jobs":300,"trigger_source":"cron-sunday"}'::jsonb, 120000);$cmd$),
      ('backfill-gap-orchestrator-weeknight',
       '0 18 * * 1-5',
       $cmd$SELECT public.cron_edge_call('backfill-gap-orchestrator', '{"mode":"run","max_scan_jobs":300,"max_dispatch_jobs":100,"trigger_source":"cron-weeknight"}'::jsonb, 120000);$cmd$),
      ('backfill-worker-dispatch',
       '7 * * * *',
       $cmd$SELECT public.cron_edge_call('backfill-worker', '{"mode":"worker","batch_size":3,"call_budget":8,"trigger_source":"cron-hourly"}'::jsonb, 120000);$cmd$)
    ) AS t(jobname, sched, cmd)
  LOOP
    PERFORM cron.unschedule(j.jobname)
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j.jobname);
    PERFORM cron.schedule(j.jobname, j.sched, j.cmd);
  END LOOP;
END $$;

-- 2) data_source_refresh_logs.status：相容既有 writer 的 done/failed，避免下一次寫入 500
ALTER TABLE public.data_source_refresh_logs
  DROP CONSTRAINT IF EXISTS data_source_refresh_logs_status_check;
ALTER TABLE public.data_source_refresh_logs
  ADD CONSTRAINT data_source_refresh_logs_status_check
  CHECK (status = ANY (ARRAY[
    'running'::text,'success'::text,'error'::text,
    'partial'::text,'skipped'::text,
    'done'::text,'failed'::text
  ]));