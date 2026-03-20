CREATE TABLE public.checkup_storage (
  key text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.checkup_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON public.checkup_storage FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public insert" ON public.checkup_storage FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow public update" ON public.checkup_storage FOR UPDATE TO anon, authenticated USING (true);