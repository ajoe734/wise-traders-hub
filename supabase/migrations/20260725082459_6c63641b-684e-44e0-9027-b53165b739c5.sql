
-- 1) publish_batch_attempts table
CREATE TABLE IF NOT EXISTS public.publish_batch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL CHECK (market IN ('TW','US')),
  attempt_no int NOT NULL DEFAULT 1,
  max_attempts int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'pending_retry' CHECK (status IN ('pending_retry','running','succeeded','failed','exhausted')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  run_id text,
  parent_attempt_id uuid REFERENCES public.publish_batch_attempts(id) ON DELETE SET NULL,
  root_attempt_id uuid,
  error_message text,
  response jsonb,
  trigger_source text NOT NULL DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pba_due ON public.publish_batch_attempts (status, next_retry_at) WHERE status = 'pending_retry';
CREATE INDEX IF NOT EXISTS idx_pba_market_created ON public.publish_batch_attempts (market, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pba_root ON public.publish_batch_attempts (root_attempt_id);

GRANT SELECT ON public.publish_batch_attempts TO authenticated;
GRANT ALL ON public.publish_batch_attempts TO service_role;

ALTER TABLE public.publish_batch_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company admins can view attempts" ON public.publish_batch_attempts;
CREATE POLICY "company admins can view attempts" ON public.publish_batch_attempts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.publish_batch_attempts_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_pba_touch ON public.publish_batch_attempts;
CREATE TRIGGER trg_pba_touch BEFORE UPDATE ON public.publish_batch_attempts
FOR EACH ROW EXECUTE FUNCTION public.publish_batch_attempts_touch();

-- 2) RPC to read attempts (company_admin)
CREATE OR REPLACE FUNCTION public.get_publish_batch_attempts(_limit int DEFAULT 60)
RETURNS TABLE (
  id uuid,
  market text,
  attempt_no int,
  max_attempts int,
  status text,
  scheduled_at timestamptz,
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  run_id text,
  parent_attempt_id uuid,
  root_attempt_id uuid,
  error_message text,
  response jsonb,
  trigger_source text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT
      a.id, a.market, a.attempt_no, a.max_attempts, a.status,
      a.scheduled_at, a.next_retry_at, a.started_at, a.finished_at,
      CASE WHEN a.started_at IS NOT NULL AND a.finished_at IS NOT NULL
           THEN (EXTRACT(EPOCH FROM (a.finished_at - a.started_at))*1000)::int
           ELSE NULL END AS duration_ms,
      a.run_id, a.parent_attempt_id, a.root_attempt_id,
      a.error_message, a.response, a.trigger_source, a.created_at
    FROM public.publish_batch_attempts a
    ORDER BY a.created_at DESC
    LIMIT LEAST(GREATEST(_limit,1), 500);
END; $$;

REVOKE ALL ON FUNCTION public.get_publish_batch_attempts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_publish_batch_attempts(int) TO authenticated;

-- 3) Reschedule pg_cron jobs to call runner (with auto-retry)
DO $$
DECLARE
  _url text := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-runner';
  _anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo';
  _wd_url text := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-watchdog';
BEGIN
  PERFORM cron.unschedule('publish-weekly-journals-tw');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN PERFORM cron.unschedule('publish-weekly-journals-us'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('publish-weekly-journals-watchdog'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'publish-weekly-journals-tw',
  '0 12 * * 5',
  $ct$
  SELECT net.http_post(
    url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-runner',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
    body:='{"market":"TW","trigger_source":"cron"}'::jsonb
  );
  $ct$
);

SELECT cron.schedule(
  'publish-weekly-journals-us',
  '0 0 * * 6',
  $ct$
  SELECT net.http_post(
    url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-runner',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
    body:='{"market":"US","trigger_source":"cron"}'::jsonb
  );
  $ct$
);

SELECT cron.schedule(
  'publish-weekly-journals-watchdog',
  '* * * * *',
  $ct$
  SELECT net.http_post(
    url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/publish-weekly-journals-watchdog',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
    body:='{}'::jsonb
  );
  $ct$
);
