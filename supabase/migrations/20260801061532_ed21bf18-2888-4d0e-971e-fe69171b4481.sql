CREATE OR REPLACE FUNCTION public.cron_edge_call(fn_name text, body jsonb DEFAULT '{}'::jsonb, timeout_ms integer DEFAULT 30000)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_key TEXT; v_url TEXT; v_req_id BIGINT;
BEGIN
  SELECT cron_key INTO v_key FROM public.internal_cron_secrets WHERE id = 1;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'cron_edge_call: CRON_SHARED_SECRET row missing';
  END IF;
  v_url := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/' || fn_name;
  -- pg_net 預設 5s 會把長工作 (worker/orchestrator/backfill) 攔腰砍斷，
  -- 造成 job 停在 running、資料長期落後。預設拉到 30s，長工作各自指定。
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Key', v_key,
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo'
    ),
    body := COALESCE(body, '{}'::jsonb),
    timeout_milliseconds := GREATEST(1000, COALESCE(timeout_ms, 30000))
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$function$;

-- 長時間工作的排程：改用 120 秒逾時
SELECT cron.alter_job(j.jobid, command := replace(j.command, '::jsonb);', '::jsonb, 120000);'))
  FROM cron.job j
 WHERE j.command LIKE '%cron_edge_call%'
   AND j.command NOT LIKE '%::jsonb, %'
   AND j.jobname IN (
     'tw-bsr-worker-trading','tw-bsr-worker-tier1-catchup','tw-bsr-window-converge-halfhour',
     'tw-bsr-enqueue-holdings-delta','tw-bsr-enqueue-post-close','tw-bsr-market-batch-probe-daily',
     'tw-chips-orchestrator-wave1','tw-chips-orchestrator-wave2','tw-chips-orchestrator-wave3',
     'tw-institutional-daily-sync','tw-institutional-fastlane','chips-guardian-every-10min',
     'backfill-worker-dispatch','backfill-gap-orchestrator-sunday','backfill-gap-orchestrator-weeknight',
     'backfill-snapshots-twse-bulk-daily','backfill-daily-snapshots-auto-resume',
     'daily-snapshot-1400','daily-performance-update','tw-bsr-prune-daily'
   );