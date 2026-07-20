CREATE TABLE IF NOT EXISTS public.tw_bsr_attempt_logs (
  id BIGSERIAL PRIMARY KEY,
  stock_id TEXT NOT NULL,
  trade_date DATE NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ua_label TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  backoff_seconds_before INTEGER NOT NULL DEFAULT 0,
  consecutive_failures_before INTEGER NOT NULL DEFAULT 0,
  ocr_mode TEXT NOT NULL DEFAULT 'standard',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  attempt_step SMALLINT NOT NULL DEFAULT 0,
  config_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bsr_attempt_logs_attempted_at ON public.tw_bsr_attempt_logs(attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_bsr_attempt_logs_ua_hash ON public.tw_bsr_attempt_logs(ua_hash);
CREATE INDEX IF NOT EXISTS idx_bsr_attempt_logs_outcome ON public.tw_bsr_attempt_logs(outcome);
CREATE INDEX IF NOT EXISTS idx_bsr_attempt_logs_backoff ON public.tw_bsr_attempt_logs(backoff_seconds_before);
CREATE INDEX IF NOT EXISTS idx_bsr_attempt_logs_consec ON public.tw_bsr_attempt_logs(consecutive_failures_before);

GRANT SELECT ON public.tw_bsr_attempt_logs TO authenticated;
GRANT ALL ON public.tw_bsr_attempt_logs TO service_role;

ALTER TABLE public.tw_bsr_attempt_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_admin read attempt logs"
  ON public.tw_bsr_attempt_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "service_role manage attempt logs"
  ON public.tw_bsr_attempt_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);