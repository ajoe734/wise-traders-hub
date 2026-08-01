CREATE OR REPLACE FUNCTION public.reap_stale_bsr_queue_jobs(_stale_minutes int DEFAULT 60)
RETURNS TABLE(reaped_jobs int, released_locks int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobs int := 0;
  v_locks int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.tw_bsr_sync_queue
       SET status = 'pending',
           next_run_at = now(),
           updated_at = now(),
           last_error = COALESCE(last_error, 'reaped_stale_running')
     WHERE status = 'running'
       AND updated_at < now() - make_interval(mins => _stale_minutes)
    RETURNING 1
  ) SELECT count(*) INTO v_jobs FROM upd;

  WITH del AS (
    DELETE FROM public.tw_bsr_sync_locks WHERE expires_at < now() RETURNING 1
  ) SELECT count(*) INTO v_locks FROM del;

  RETURN QUERY SELECT v_jobs, v_locks;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stale_bsr_queue_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_bsr_queue_jobs(int) TO service_role;

SELECT public.reap_stale_bsr_queue_jobs(60);

SELECT cron.schedule('tw-bsr-reap-stale-jobs', '*/10 * * * *',
  $$SELECT public.reap_stale_bsr_queue_jobs(60);$$);