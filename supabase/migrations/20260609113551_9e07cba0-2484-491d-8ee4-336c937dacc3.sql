-- ============ checkup_analysis_jobs ============
CREATE TABLE public.checkup_analysis_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  holdings_snapshot jsonb,
  result_summary jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkup_jobs_user_created ON public.checkup_analysis_jobs(user_id, created_at DESC);
CREATE INDEX idx_checkup_jobs_status ON public.checkup_analysis_jobs(status) WHERE status IN ('queued','running');

GRANT SELECT, INSERT, UPDATE ON public.checkup_analysis_jobs TO authenticated;
GRANT ALL ON public.checkup_analysis_jobs TO service_role;

ALTER TABLE public.checkup_analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own jobs"
  ON public.checkup_analysis_jobs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own jobs"
  ON public.checkup_analysis_jobs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own jobs"
  ON public.checkup_analysis_jobs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger（沿用既有函式若存在則重用）
CREATE OR REPLACE FUNCTION public.tg_checkup_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_checkup_jobs_updated_at
  BEFORE UPDATE ON public.checkup_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_checkup_jobs_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.checkup_analysis_jobs;
ALTER TABLE public.checkup_analysis_jobs REPLICA IDENTITY FULL;

-- ============ checkup_daily_reminders ============
CREATE TABLE public.checkup_daily_reminders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminded_on date NOT NULL,
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reminded_on)
);

CREATE INDEX idx_checkup_reminders_date ON public.checkup_daily_reminders(reminded_on DESC);

GRANT SELECT ON public.checkup_daily_reminders TO authenticated;
GRANT ALL ON public.checkup_daily_reminders TO service_role;

ALTER TABLE public.checkup_daily_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own reminders"
  ON public.checkup_daily_reminders FOR SELECT
  TO authenticated USING (auth.uid() = user_id);