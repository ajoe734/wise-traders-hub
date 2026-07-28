
DO $$
DECLARE
  r RECORD;
  v_key TEXT;
  v_new_cmd TEXT;
  v_count INT := 0;
BEGIN
  SELECT cron_key INTO v_key FROM public.internal_cron_secrets WHERE id = 1;

  FOR r IN
    SELECT jobid, command FROM cron.job
    WHERE command LIKE '%functions/v1/%'
      AND command NOT LIKE '%X-Cron-Key%'
  LOOP
    v_new_cmd := regexp_replace(
      r.command,
      '("Content-Type"\s*:\s*"application/json")',
      '\1, "X-Cron-Key": "' || v_key || '"',
      'g'
    );
    PERFORM cron.alter_job(job_id := r.jobid, command := v_new_cmd);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'patched % cron jobs', v_count;
END $$;
