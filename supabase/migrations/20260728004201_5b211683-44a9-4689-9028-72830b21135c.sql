-- Introspection helper: expose cron.job to service_role for audit tooling.
CREATE OR REPLACE FUNCTION public.admin_list_cron_jobs()
RETURNS TABLE (
  jobid BIGINT,
  jobname TEXT,
  schedule TEXT,
  command TEXT,
  active BOOLEAN,
  database TEXT,
  username TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT j.jobid, j.jobname, j.schedule, j.command, j.active, j.database, j.username
  FROM cron.job j
  ORDER BY j.jobname NULLS LAST, j.jobid;
$$;
REVOKE ALL ON FUNCTION public.admin_list_cron_jobs() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_cron_jobs() TO service_role, postgres;

-- Migrate every cron.job whose command still calls net.http_post directly to use
-- public.cron_edge_call(fn_name, body). This removes the anon key and X-Cron-Key
-- header literals from cron.job.command entirely.
DO $migrate$
DECLARE
  r RECORD;
  v_fn TEXT;
  v_body TEXT;
  v_new_cmd TEXT;
  v_body_json JSONB;
BEGIN
  FOR r IN
    SELECT jobid, jobname, schedule, command
    FROM cron.job
    WHERE command ILIKE '%net.http_post%'
      AND command NOT ILIKE '%cron_edge_call%'
  LOOP
    -- Extract function name after /functions/v1/
    v_fn := substring(r.command FROM '/functions/v1/([a-zA-Z0-9_\-]+)');
    IF v_fn IS NULL THEN
      RAISE NOTICE 'skip job % (%): cannot parse fn name', r.jobid, r.jobname;
      CONTINUE;
    END IF;

    -- Best-effort body extraction: look for body := '<json>'::jsonb or body:='<json>'::jsonb
    v_body := substring(r.command FROM 'body\s*:=\s*''(\{[^'']*\})''\s*::\s*jsonb');
    BEGIN
      v_body_json := COALESCE(v_body::jsonb, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_body_json := '{}'::jsonb;
    END;

    v_new_cmd := format(
      'SELECT public.cron_edge_call(%L, %L::jsonb);',
      v_fn,
      v_body_json::text
    );

    PERFORM cron.alter_job(job_id := r.jobid, command := v_new_cmd);
    RAISE NOTICE 'migrated job % (%) -> %', r.jobid, r.jobname, v_fn;
  END LOOP;
END
$migrate$;