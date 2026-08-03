-- Phase: FinMind 歷史回填 pipeline 修復（2026-08-03）
-- 三個 scheduler-only job 一律走 public.cron_edge_call（自帶 X-Cron-Key），
-- 且 worker 改為「每小時抓一點」：每次固定 call_budget=12（硬上限 24，遠低於 30/hour）。
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
       $cmd$SELECT public.cron_edge_call('backfill-worker', '{"mode":"worker","batch_size":3,"call_budget":12,"trigger_source":"cron-hourly"}'::jsonb, 120000);$cmd$)
    ) AS t(jobname, sched, cmd)
  LOOP
    PERFORM cron.unschedule(j.jobname)
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j.jobname);
    PERFORM cron.schedule(j.jobname, j.sched, j.cmd);
  END LOOP;
END $$;