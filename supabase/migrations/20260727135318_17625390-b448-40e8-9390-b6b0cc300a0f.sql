CREATE TABLE IF NOT EXISTS public.tw_bsr_keepwarm_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL,
  wave smallint NOT NULL DEFAULT 0,
  status text NOT NULL,
  sealed boolean NOT NULL DEFAULT false,
  sealed_by_lane text,
  coverage_stocks int NOT NULL DEFAULT 0,
  coverage_brokers int NOT NULL DEFAULT 0,
  fallback_used_count int NOT NULL DEFAULT 0,
  duration_ms int NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.tw_bsr_keepwarm_metrics TO service_role;
GRANT SELECT ON public.tw_bsr_keepwarm_metrics TO authenticated;

ALTER TABLE public.tw_bsr_keepwarm_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read keepwarm metrics"
  ON public.tw_bsr_keepwarm_metrics
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE INDEX IF NOT EXISTS tw_bsr_keepwarm_metrics_date_wave_idx
  ON public.tw_bsr_keepwarm_metrics (trade_date DESC, wave, started_at DESC);

CREATE INDEX IF NOT EXISTS tw_bsr_keepwarm_metrics_started_idx
  ON public.tw_bsr_keepwarm_metrics (started_at DESC);