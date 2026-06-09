CREATE TABLE public.line_push_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  recipient_user_ids uuid[] NOT NULL,
  message_kind text NOT NULL CHECK (message_kind IN ('text','text_with_action','image')),
  text text,
  action_label text,
  action_url text,
  image_url text,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','partial','failed','canceled')),
  sent_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  result jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX line_push_jobs_status_scheduled_idx ON public.line_push_jobs(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX line_push_jobs_created_at_idx ON public.line_push_jobs(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.line_push_jobs TO authenticated;
GRANT ALL ON public.line_push_jobs TO service_role;

ALTER TABLE public.line_push_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all line push jobs"
  ON public.line_push_jobs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Admins insert line push jobs"
  ON public.line_push_jobs FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'company_admin') AND created_by = auth.uid());

CREATE POLICY "Admins update line push jobs"
  ON public.line_push_jobs FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));

CREATE TRIGGER update_line_push_jobs_updated_at
  BEFORE UPDATE ON public.line_push_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();