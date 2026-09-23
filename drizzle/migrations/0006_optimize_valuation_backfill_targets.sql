CREATE OR REPLACE FUNCTION public.valuation_backfill_targets(_limit int DEFAULT 100, _min_rows int DEFAULT 250)
RETURNS TABLE(symbol text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cnt AS (
    SELECT v.symbol AS symbol, count(*) AS c
    FROM public.tw_valuation_daily v
    WHERE v.trade_date >= (CURRENT_DATE - INTERVAL '5 years')
    GROUP BY v.symbol
  )
  SELECT p.symbol
  FROM public.tw_industry_peers p
  LEFT JOIN cnt ON cnt.symbol = p.symbol
  WHERE p.symbol ~ '^[0-9]{4}$'
    AND p.industry NOT IN ('ETF','ETN','受益證券','存託憑證','指數投資證券(ETN)','所有證券')
    AND COALESCE(cnt.c, 0) < _min_rows
  ORDER BY p.symbol
  LIMIT GREATEST(_limit, 1)
$$;

REVOKE ALL ON FUNCTION public.valuation_backfill_targets(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valuation_backfill_targets(int, int) TO service_role;