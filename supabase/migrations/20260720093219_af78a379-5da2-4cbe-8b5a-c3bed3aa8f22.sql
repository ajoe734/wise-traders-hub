
ALTER TABLE public.tw_bsr_attempt_logs
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_as_of_date date,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_source text;

CREATE INDEX IF NOT EXISTS idx_tw_bsr_attempt_logs_stock_time
  ON public.tw_bsr_attempt_logs (stock_id, attempted_at DESC);
