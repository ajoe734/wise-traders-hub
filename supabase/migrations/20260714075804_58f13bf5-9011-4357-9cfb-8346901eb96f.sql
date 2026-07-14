CREATE TABLE public.fx_rates (
  currency_pair TEXT PRIMARY KEY,
  rate NUMERIC NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fx_rates TO anon, authenticated;
GRANT ALL ON public.fx_rates TO service_role;

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fx_rates read for everyone"
ON public.fx_rates FOR SELECT
USING (true);

-- 種一筆保底值（Yahoo Finance TWD=X 近日約 31.5，作為離線 fallback，不會覆蓋定時任務更新）
INSERT INTO public.fx_rates (currency_pair, rate, source, fetched_at)
VALUES ('USDTWD', 31.5, 'seed', now())
ON CONFLICT (currency_pair) DO NOTHING;