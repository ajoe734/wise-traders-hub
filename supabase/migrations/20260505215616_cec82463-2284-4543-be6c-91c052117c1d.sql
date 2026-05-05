
CREATE TABLE IF NOT EXISTS public.knowledge_sync_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notify_user_ids uuid[] NOT NULL DEFAULT '{}',
  notify_on_success boolean NOT NULL DEFAULT false,
  notify_on_failure boolean NOT NULL DEFAULT true,
  retry_on_failure boolean NOT NULL DEFAULT true,
  max_retries int NOT NULL DEFAULT 2,
  retry_delay_ms int NOT NULL DEFAULT 1500,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.knowledge_sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sync settings" ON public.knowledge_sync_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

INSERT INTO public.knowledge_sync_settings (notify_user_ids) VALUES ('{}')
  ON CONFLICT DO NOTHING;
