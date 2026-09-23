ALTER TABLE public.stock_industry_map
  ADD COLUMN IF NOT EXISTS market_groups text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS stock_industry_map_market_groups_gin
  ON public.stock_industry_map USING gin (market_groups);