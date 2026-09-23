CREATE OR REPLACE FUNCTION public.valuation_snapshot(_symbol text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sym AS (SELECT btrim(_symbol) AS s),
  latest AS (
    SELECT v.* FROM public.tw_valuation_daily v CROSS JOIN sym
    WHERE v.symbol = sym.s ORDER BY v.trade_date DESC LIMIT 1
  ),
  hist AS (
    SELECT v.trade_date, v.per, v.pbr, v.dividend_yield
    FROM public.tw_valuation_daily v CROSS JOIN sym
    WHERE v.symbol = sym.s AND v.trade_date >= (CURRENT_DATE - INTERVAL '5 years')
  ),
  trend_raw AS (
    SELECT DISTINCT ON (date_trunc('month', h.trade_date))
      h.trade_date, h.per, h.pbr, h.dividend_yield
    FROM hist h
    ORDER BY date_trunc('month', h.trade_date), h.trade_date DESC
  ),
  me AS (
    SELECT m.industries, m.official_industry, m.market
    FROM public.stock_industry_map m CROSS JOIN sym WHERE m.symbol = sym.s
  ),
  ind AS (
    SELECT
      COALESCE((SELECT industries[1] FROM me),
               (SELECT p.industry FROM public.tw_industry_peers p CROSS JOIN sym WHERE p.symbol = sym.s)) AS industry,
      ((SELECT industries[1] FROM me) IS NOT NULL) AS fine,
      (SELECT official_industry FROM me) AS broad_industry,
      COALESCE((SELECT market FROM me),
               (SELECT p.market FROM public.tw_industry_peers p CROSS JOIN sym WHERE p.symbol = sym.s)) AS market
  ),
  fine_syms AS (
    SELECT m.symbol, m.market
    FROM public.stock_industry_map m CROSS JOIN ind CROSS JOIN sym
    WHERE ind.fine
      AND m.industries && (SELECT industries FROM me)
      AND m.symbol <> sym.s
      AND (ind.market IS NULL OR m.market IS NULL OR m.market = ind.market)
  ),
  broad_syms AS (
    SELECT m.symbol, m.market
    FROM public.stock_industry_map m CROSS JOIN ind CROSS JOIN sym
    WHERE ind.broad_industry IS NOT NULL
      AND m.official_industry = ind.broad_industry
      AND m.symbol <> sym.s
      AND (ind.market IS NULL OR m.market IS NULL OR m.market = ind.market)
  ),
  legacy_syms AS (
    SELECT p.symbol, p.market
    FROM public.tw_industry_peers p CROSS JOIN ind CROSS JOIN sym
    WHERE NOT ind.fine AND p.industry = ind.industry AND p.symbol <> sym.s
      AND (ind.market IS NULL OR p.market IS NULL OR p.market = ind.market)
  ),
  fine_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield
    FROM fine_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (
      SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1
    ) lv ON true
  ),
  broad_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield
    FROM broad_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (
      SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1
    ) lv ON true
  ),
  legacy_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield
    FROM legacy_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (
      SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1
    ) lv ON true
  ),
  chosen AS (
    SELECT
      CASE
        WHEN (SELECT count(*) FROM fine_rows WHERE per IS NOT NULL OR pbr IS NOT NULL) >= 3 THEN 'fine'
        WHEN (SELECT count(*) FROM broad_rows WHERE per IS NOT NULL OR pbr IS NOT NULL) >= 3 THEN 'broad'
        WHEN (SELECT count(*) FROM fine_rows) > 0 THEN 'fine'
        WHEN (SELECT count(*) FROM legacy_rows) > 0 THEN 'legacy'
        ELSE 'fine'
      END AS scope
  ),
  peer_rows AS (
    SELECT * FROM fine_rows WHERE (SELECT scope FROM chosen) = 'fine'
    UNION ALL
    SELECT * FROM broad_rows WHERE (SELECT scope FROM chosen) = 'broad'
    UNION ALL
    SELECT * FROM legacy_rows WHERE (SELECT scope FROM chosen) = 'legacy'
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
    'peerScope', (SELECT scope FROM chosen),
    'peerIndustry', CASE WHEN (SELECT scope FROM chosen) = 'broad'
                         THEN (SELECT broad_industry FROM ind)
                         ELSE (SELECT industry FROM ind) END,
    'history', jsonb_build_object(
      'pe', COALESCE((SELECT jsonb_agg(per ORDER BY trade_date) FROM hist WHERE per IS NOT NULL), '[]'::jsonb),
      'pb', COALESCE((SELECT jsonb_agg(pbr ORDER BY trade_date) FROM hist WHERE pbr IS NOT NULL), '[]'::jsonb),
      'dividendYield', COALESCE((SELECT jsonb_agg(dividend_yield ORDER BY trade_date) FROM hist WHERE dividend_yield IS NOT NULL), '[]'::jsonb)
    ),
    'trend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(trade_date, 'YYYY-MM-DD'),
        'pe', per,
        'pb', pbr,
        'dividendYield', dividend_yield
      ) ORDER BY trade_date)
      FROM trend_raw
    ), '[]'::jsonb),
    'peers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'name', name, 'pe', per, 'pb', pbr, 'dividendYield', dividend_yield))
      FROM peer_rows
    ), '[]'::jsonb)
  );
$function$;