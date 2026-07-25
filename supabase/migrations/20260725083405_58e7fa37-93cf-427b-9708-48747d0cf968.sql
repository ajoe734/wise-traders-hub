-- 1) 打開 keep_warm flag
UPDATE public.tw_bsr_sync_config
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{enabled}',
  'true'::jsonb,
  true
),
updated_at = now()
WHERE key = 'keep_warm_schedule';

-- 2) 排除舊排程（若曾建立）
DO $$ BEGIN PERFORM cron.unschedule('tw-inst-keep-warm-wave1'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('tw-inst-keep-warm-wave2'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('tw-inst-keep-warm-wave3'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 3) 三波 cron：UTC 07:30 / 09:30 / 11:30 週一到週五
--    對應台北 15:30 / 17:30 / 19:30
SELECT cron.schedule(
  'tw-inst-keep-warm-wave1',
  '30 7 * * 1-5',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/tw-institutional-daily-sync',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"mode":"keep_warm","wave":"15:30+08","lookback":3}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'tw-inst-keep-warm-wave1', request_id FROM r;
  $ct$
);

SELECT cron.schedule(
  'tw-inst-keep-warm-wave2',
  '30 9 * * 1-5',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/tw-institutional-daily-sync',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"mode":"keep_warm","wave":"17:30+08","lookback":3}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'tw-inst-keep-warm-wave2', request_id FROM r;
  $ct$
);

SELECT cron.schedule(
  'tw-inst-keep-warm-wave3',
  '30 11 * * 1-5',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/tw-institutional-daily-sync',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"mode":"keep_warm","wave":"19:30+08","lookback":3}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'tw-inst-keep-warm-wave3', request_id FROM r;
  $ct$
);