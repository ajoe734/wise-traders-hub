CREATE TABLE public.checkup_trade_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  trade_date text,
  trade_time text,
  action text,
  code text,
  name text,
  qty numeric,
  price numeric,
  qa jsonb DEFAULT '[]'::jsonb
);

ALTER TABLE public.checkup_trade_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read trade memos" ON public.checkup_trade_memos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public insert trade memos" ON public.checkup_trade_memos FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow public update trade memos" ON public.checkup_trade_memos FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "Allow public delete trade memos" ON public.checkup_trade_memos FOR DELETE TO anon, authenticated USING (true);