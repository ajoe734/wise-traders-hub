-- 1) dispatch log 表：把每次 cron 觸發的 net.http_post request_id 記下來
CREATE TABLE IF NOT EXISTS public.cron_dispatch_log (
  id bigserial PRIMARY KEY,
  jobname text NOT NULL,
  request_id bigint,
  dispatched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cdl_job_time ON public.cron_dispatch_log (jobname, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_cdl_request ON public.cron_dispatch_log (request_id);

GRANT SELECT ON public.cron_dispatch_log TO authenticated;
GRANT ALL ON public.cron_dispatch_log TO service_role;

ALTER TABLE public.cron_dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company admins can view cron dispatch log" ON public.cron_dispatch_log;
CREATE POLICY "company admins can view cron dispatch log" ON public.cron_dispatch_log
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'company_admin'::public.app_role));

-- 2) 每日清理：只保留 14 天
CREATE OR REPLACE FUNCTION public.prune_cron_dispatch_log()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.cron_dispatch_log WHERE dispatched_at < now() - interval '14 days';
$$;

-- 3) 重排 publish-weekly-journals-{tw,us,watchdog}，把 request_id 寫入 dispatch log
DO $$ BEGIN PERFORM cron.unschedule('publish-weekly-journals-tw'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('publish-weekly-journals-us'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('publish-weekly-journals-watchdog'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'publish-weekly-journals-tw',
  '0 12 * * 5',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-runner',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"market":"TW","trigger_source":"cron"}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'publish-weekly-journals-tw', request_id FROM r;
  $ct$
);

SELECT cron.schedule(
  'publish-weekly-journals-us',
  '0 0 * * 6',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-runner',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"market":"US","trigger_source":"cron"}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'publish-weekly-journals-us', request_id FROM r;
  $ct$
);

SELECT cron.schedule(
  'publish-weekly-journals-watchdog',
  '* * * * *',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-watchdog',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'publish-weekly-journals-watchdog', request_id FROM r;
  $ct$
);

-- 4) 每天凌晨清理 dispatch log
DO $$ BEGIN PERFORM cron.unschedule('prune-cron-dispatch-log'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'prune-cron-dispatch-log',
  '17 3 * * *',
  $ct$ SELECT public.prune_cron_dispatch_log(); $ct$
);

-- 5) RPC：回傳 cron 執行紀錄（cron 本身狀態 + HTTP 實際結果 + 耗時）
CREATE OR REPLACE FUNCTION public.get_cron_job_runs(
  _jobnames text[] DEFAULT ARRAY['publish-weekly-journals-tw','publish-weekly-journals-us','publish-weekly-journals-watchdog']::text[],
  _limit int DEFAULT 100
)
RETURNS TABLE (
  jobname text,
  runid bigint,
  cron_status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz,
  sql_duration_ms int,
  request_id bigint,
  http_status int,
  http_error text,
  http_response_snippet text,
  http_duration_ms int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
  WITH runs AS (
    SELECT j.jobname, d.runid, d.status AS cron_status, d.return_message,
           d.start_time, d.end_time,
           GREATEST(0, (EXTRACT(EPOCH FROM (d.end_time - d.start_time)) * 1000)::int) AS sql_duration_ms
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
    WHERE j.jobname = ANY(_jobnames)
    ORDER BY d.start_time DESC
    LIMIT _limit
  ),
  matched AS (
    SELECT r.*,
           (
             SELECT cdl.request_id
             FROM public.cron_dispatch_log cdl
             WHERE cdl.jobname = r.jobname
               AND cdl.dispatched_at >= r.start_time - interval '1 second'
               AND cdl.dispatched_at <= r.end_time + interval '2 seconds'
             ORDER BY cdl.dispatched_at ASC
             LIMIT 1
           ) AS request_id
    FROM runs r
  )
  SELECT m.jobname, m.runid, m.cron_status, m.return_message,
         m.start_time, m.end_time, m.sql_duration_ms,
         m.request_id,
         resp.status_code AS http_status,
         resp.error_msg AS http_error,
         LEFT(COALESCE(resp.content::text, ''), 400) AS http_response_snippet,
         CASE WHEN resp.created IS NOT NULL
              THEN GREATEST(0, (EXTRACT(EPOCH FROM (resp.created - m.start_time)) * 1000)::int)
              ELSE NULL END AS http_duration_ms
  FROM matched m
  LEFT JOIN net._http_response resp ON resp.id = m.request_id
  ORDER BY m.start_time DESC
$$;

REVOKE ALL ON FUNCTION public.get_cron_job_runs(text[], int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_job_runs(text[], int) TO authenticated;

-- 6) 簡短 job 清單（給前端下拉）
CREATE OR REPLACE FUNCTION public.get_cron_jobs()
RETURNS TABLE (jobid bigint, jobname text, schedule text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, cron AS $$
  SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
$$;
REVOKE ALL ON FUNCTION public.get_cron_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_jobs() TO authenticated;