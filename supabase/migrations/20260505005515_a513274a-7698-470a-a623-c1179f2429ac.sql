CREATE TABLE IF NOT EXISTS public.function_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  fn text NOT NULL,
  run_id text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  stage text,
  msg text,
  expert_id uuid,
  signal_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_function_run_logs_run_id ON public.function_run_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_function_run_logs_fn_created ON public.function_run_logs (fn, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_run_logs_level ON public.function_run_logs (level);

ALTER TABLE public.function_run_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can view function logs"
  ON public.function_run_logs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Company admins can delete function logs"
  ON public.function_run_logs FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));
