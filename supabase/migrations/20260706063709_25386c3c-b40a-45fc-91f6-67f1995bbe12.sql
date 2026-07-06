
CREATE TABLE public.data_source_refresh_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_key TEXT NOT NULL,
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running','success','error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  row_count INTEGER,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_data_source_refresh_logs_source_started
  ON public.data_source_refresh_logs (source_key, started_at DESC);

GRANT SELECT ON public.data_source_refresh_logs TO authenticated;
GRANT ALL ON public.data_source_refresh_logs TO service_role;

ALTER TABLE public.data_source_refresh_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all refresh logs"
  ON public.data_source_refresh_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Users can read their own refresh logs"
  ON public.data_source_refresh_logs
  FOR SELECT
  TO authenticated
  USING (triggered_by = auth.uid());
