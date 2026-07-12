
CREATE TABLE public.ai_gateway_usage_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID,
  expert_id UUID,
  expert_slug TEXT,
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  run_id TEXT,
  log_id TEXT,
  correlation_id TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  finish_reason TEXT,
  cost_usd NUMERIC(12,6),
  meta JSONB
);

CREATE INDEX idx_aigw_usage_created ON public.ai_gateway_usage_logs (created_at DESC);
CREATE INDEX idx_aigw_usage_user ON public.ai_gateway_usage_logs (user_id, created_at DESC);
CREATE INDEX idx_aigw_usage_run ON public.ai_gateway_usage_logs (run_id);
CREATE INDEX idx_aigw_usage_log ON public.ai_gateway_usage_logs (log_id);
CREATE INDEX idx_aigw_usage_model ON public.ai_gateway_usage_logs (model);

GRANT SELECT ON public.ai_gateway_usage_logs TO authenticated;
GRANT ALL ON public.ai_gateway_usage_logs TO service_role;

ALTER TABLE public.ai_gateway_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_admin can read ai gateway usage"
  ON public.ai_gateway_usage_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));
