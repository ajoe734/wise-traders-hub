
-- Drop and recreate user_summaries
DROP TABLE IF EXISTS public.user_summaries;

CREATE TABLE public.user_summaries (
  user_id uuid NOT NULL PRIMARY KEY,
  total_pnl_percent double precision DEFAULT 0,
  avg_pnl_percent double precision DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_summaries ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own summary"
  ON public.user_summaries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Company admins full access summaries"
  ON public.user_summaries FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_summaries;
