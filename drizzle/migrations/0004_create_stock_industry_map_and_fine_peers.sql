CREATE TABLE IF NOT EXISTS public.stock_industry_map (
  symbol text PRIMARY KEY,
  name text,
  market text,
  official_industry text,
  industries text[] NOT NULL DEFAULT '{}',
  revenue_mix jsonb,
  themes text[] NOT NULL DEFAULT '{}',
  confidence numeric,
  model text,
  rationale text,
  reviewed boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'ai',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stock_industry_map TO anon;
GRANT SELECT ON public.stock_industry_map TO authenticated;
GRANT ALL ON public.stock_industry_map TO service_role;

ALTER TABLE public.stock_industry_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_industry_map_public_read ON public.stock_industry_map;
CREATE POLICY stock_industry_map_public_read ON public.stock_industry_map
  FOR SELECT USING (true);

DROP POLICY IF EXISTS stock_industry_map_service_all ON public.stock_industry_map;
CREATE POLICY stock_industry_map_service_all ON public.stock_industry_map
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS stock_industry_map_primary_idx
  ON public.stock_industry_map ((industries[1]));

CREATE OR REPLACE FUNCTION public.valuation_snapshot(_symbol text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sym AS (
    SELECT btrim(_symbol) AS s
  ),
  latest AS (
    SELECT v.*
    FROM public.tw_valuation_daily v CROSS JOIN sym
    WHERE v.symbol = sym.s
    ORDER BY v.trade_date DESC
    LIMIT 1
  ),
  hist AS (
    SELECT v.per, v.pbr, v.dividend_yield
    FROM public.tw_valuation_daily v CROSS JOIN sym
    WHERE v.symbol = sym.s
      AND v.trade_date >= (CURRENT_DATE - INTERVAL '5 years')
  ),
  ind AS (
    SELECT
      COALESCE(
        (SELECT m.industries[1] FROM public.stock_industry_map m CROSS JOIN sym WHERE m.symbol = sym.s),
        (SELECT p.industry FROM public.tw_industry_peers p CROSS JOIN sym WHERE p.symbol = sym.s)
      ) AS industry,
      ((SELECT m.industries[1] FROM public.stock_industry_map m CROSS JOIN sym WHERE m.symbol = sym.s) IS NOT NULL) AS fine,
      COALESCE(
        (SELECT m.market FROM public.stock_industry_map m CROSS JOIN sym WHERE m.symbol = sym.s),
        (SELECT p.market FROM public.tw_industry_peers p CROSS JOIN sym WHERE p.symbol = sym.s)
      ) AS market
  ),
  peer_syms AS (
    SELECT m.symbol AS symbol, m.market AS market
    FROM public.stock_industry_map m CROSS JOIN ind
    WHERE ind.fine AND m.industries[1] = ind.industry
    UNION
    SELECT p.symbol AS symbol, p.market AS market
    FROM public.tw_industry_peers p CROSS JOIN ind
    WHERE NOT ind.fine AND p.industry = ind.industry
  )
  SELECT jsonb_build_object(
    'symbol', (SELECT s FROM sym),
    'asOf', (SELECT to_char(trade_date, 'YYYY-MM-DD') FROM latest),
    'source', (SELECT source FROM latest),
    'pe', (SELECT per FROM latest),
    'pb', (SELECT pbr FROM latest),
    'dividendYield', (SELECT dividend_yield FROM latest),
    'industry', (SELECT industry FROM ind),
    'industryFine', (SELECT fine FROM ind),
    'history', jsonb_build_object(
      'pe', COALESCE((SELECT jsonb_agg(per) FROM hist WHERE per IS NOT NULL), '[]'::jsonb),
      'pb', COALESCE((SELECT jsonb_agg(pbr) FROM hist WHERE pbr IS NOT NULL), '[]'::jsonb),
      'dividendYield', COALESCE((SELECT jsonb_agg(dividend_yield) FROM hist WHERE dividend_yield IS NOT NULL), '[]'::jsonb)
    ),
    'peers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'symbol', ps.symbol,
        'name', n.name,
        'pe', lv.per, 'pb', lv.pbr, 'dividendYield', lv.dividend_yield))
      FROM peer_syms ps
      CROSS JOIN ind
      CROSS JOIN sym
      LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
      JOIN LATERAL (
        SELECT v.per, v.pbr, v.dividend_yield
        FROM public.tw_valuation_daily v
        WHERE v.symbol = ps.symbol
        ORDER BY v.trade_date DESC
        LIMIT 1
      ) lv ON true
      WHERE ps.symbol <> sym.s
        AND (ind.market IS NULL OR ps.market IS NULL OR ps.market = ind.market)
    ), '[]'::jsonb)
  );
$function$;