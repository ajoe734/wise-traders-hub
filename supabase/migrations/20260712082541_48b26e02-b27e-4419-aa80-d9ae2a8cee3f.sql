CREATE TABLE public.expert_ai_access_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  expert_id uuid,
  expert_slug text,
  decision text NOT NULL CHECK (decision IN ('allowed','denied')),
  rule text NOT NULL,
  subscription_status text,
  plan_id uuid,
  plan_type text,
  quota_used integer,
  quota_limit integer,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expert_ai_access_logs_created_at ON public.expert_ai_access_logs (created_at DESC);
CREATE INDEX idx_expert_ai_access_logs_expert_slug ON public.expert_ai_access_logs (expert_slug, created_at DESC);
CREATE INDEX idx_expert_ai_access_logs_user_id ON public.expert_ai_access_logs (user_id, created_at DESC);
CREATE INDEX idx_expert_ai_access_logs_decision ON public.expert_ai_access_logs (decision, created_at DESC);

GRANT SELECT ON public.expert_ai_access_logs TO authenticated;
GRANT ALL ON public.expert_ai_access_logs TO service_role;

ALTER TABLE public.expert_ai_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can view expert AI access logs"
  ON public.expert_ai_access_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE OR REPLACE FUNCTION public.cleanup_old_expert_ai_access_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.expert_ai_access_logs WHERE created_at < now() - INTERVAL '30 days';
$$;