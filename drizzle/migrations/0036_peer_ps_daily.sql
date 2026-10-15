CREATE TABLE public.tw_sales_basis (
  symbol text PRIMARY KEY,
  sps numeric NOT NULL CHECK (sps > 0),
  period text NOT NULL,
  latest_period date NOT NULL,
  source text NOT NULL DEFAULT 'valuation-fundamentals',
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tw_sales_basis TO anon, authenticated;
GRANT ALL ON public.tw_sales_basis TO service_role;
ALTER TABLE public.tw_sales_basis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales basis public read" ON public.tw_sales_basis FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.tw_ps_daily (
  symbol text NOT NULL,
  trade_date date NOT NULL,
  ps numeric NOT NULL CHECK (ps > 0),
  close numeric,
  sps numeric,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, trade_date)
);
GRANT SELECT ON public.tw_ps_daily TO anon, authenticated;
GRANT ALL ON public.tw_ps_daily TO service_role;
ALTER TABLE public.tw_ps_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps daily public read" ON public.tw_ps_daily FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX tw_ps_daily_symbol_date_idx ON public.tw_ps_daily (symbol, trade_date DESC);

DROP FUNCTION IF EXISTS public.valuation_peer_multiples(text[]);
CREATE FUNCTION public.valuation_peer_multiples(_symbols text[])
 RETURNS TABLE(symbol text, trade_date date, pe numeric, pb numeric, ps numeric, ps_date date)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT s, lv.trade_date, lv.per, lv.pbr, lp.ps, lp.trade_date
  FROM unnest(_symbols[1:20]) AS s
  LEFT JOIN LATERAL (SELECT v.trade_date, v.per, v.pbr FROM public.tw_valuation_daily v
    WHERE v.symbol = s ORDER BY v.trade_date DESC LIMIT 1) lv ON true
  LEFT JOIN LATERAL (SELECT p.trade_date, p.ps FROM public.tw_ps_daily p
    WHERE p.symbol = s AND p.trade_date >= current_date - 10 ORDER BY p.trade_date DESC LIMIT 1) lp ON true
  WHERE lv.trade_date IS NOT NULL OR lp.trade_date IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION public.valuation_peer_multiples(text[]) TO anon, authenticated, service_role;