
ALTER TABLE public.tw_bsr_fetch_failures ADD COLUMN IF NOT EXISTS error_class text;
ALTER TABLE public.tw_bsr_attempt_logs ADD COLUMN IF NOT EXISTS error_class text;
CREATE INDEX IF NOT EXISTS idx_tw_bsr_fetch_failures_error_class ON public.tw_bsr_fetch_failures (error_class);
CREATE INDEX IF NOT EXISTS idx_tw_bsr_attempt_logs_error_class ON public.tw_bsr_attempt_logs (error_class);
CREATE INDEX IF NOT EXISTS idx_tw_bsr_attempt_logs_attempted_at ON public.tw_bsr_attempt_logs (attempted_at);
