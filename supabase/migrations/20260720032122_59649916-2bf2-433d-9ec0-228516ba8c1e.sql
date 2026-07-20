
ALTER TABLE public.tw_bsr_fetch_failures
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS backoff_seconds int NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS consecutive_failures int NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS tw_bsr_fetch_failures_next_retry_idx
  ON public.tw_bsr_fetch_failures (next_retry_at)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tw_bsr_sync_locks (
  lock_key text PRIMARY KEY,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
GRANT ALL ON public.tw_bsr_sync_locks TO service_role;
ALTER TABLE public.tw_bsr_sync_locks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tw_bsr_sync_metrics (
  bucket_at timestamptz PRIMARY KEY,
  total int NOT NULL DEFAULT 0,
  success int NOT NULL DEFAULT 0,
  ocr_fail int NOT NULL DEFAULT 0,
  http_block int NOT NULL DEFAULT 0,
  empty int NOT NULL DEFAULT 0,
  avg_latency_ms int NOT NULL DEFAULT 0
);
GRANT ALL ON public.tw_bsr_sync_metrics TO service_role;
GRANT SELECT ON public.tw_bsr_sync_metrics TO authenticated;
ALTER TABLE public.tw_bsr_sync_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read bsr metrics" ON public.tw_bsr_sync_metrics
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));
