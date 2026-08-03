CREATE OR REPLACE FUNCTION public.claim_backfill_jobs(
  _batch_size INTEGER DEFAULT 1,
  _max_priority_score INTEGER DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT,
  dataset TEXT,
  stock_id TEXT,
  start_date DATE,
  end_date DATE,
  source_hint TEXT,
  payload JSONB,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts TIMESTAMPTZ := now();
BEGIN
  UPDATE public.backfill_job_queue
  SET status = 'pending',
      last_error = 'STALE_RUNNING_RECOVERED',
      next_run_at = now_ts,
      updated_at = now_ts
  WHERE status = 'running'
    AND updated_at < now_ts - interval '15 minutes';

  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.backfill_job_queue q
    WHERE q.status = 'pending'
      AND q.next_run_at <= now_ts
      AND (_max_priority_score IS NULL OR q.priority_score <= _max_priority_score)
    ORDER BY q.priority_score DESC, q.next_run_at ASC, q.id ASC
    LIMIT GREATEST(1, LEAST(COALESCE(_batch_size, 1), 10))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.backfill_job_queue q
  SET status = 'running',
      updated_at = now_ts,
      attempts = q.attempts + 1,
      last_error = NULL
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.id, q.dataset, q.stock_id, q.start_date, q.end_date, q.source_hint, q.payload, q.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_backfill_jobs(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_backfill_jobs(INTEGER, INTEGER) TO authenticated, service_role;