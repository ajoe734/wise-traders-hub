CREATE OR REPLACE FUNCTION public.valuation_backfill_targets(
  _limit integer DEFAULT 100,
  _min_rows integer DEFAULT 250
)
RETURNS TABLE(symbol text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cnt AS (
    SELECT v.symbol AS symbol, count(*) AS c, max(v.fetched_at) AS last_fetch
    FROM public.tw_valuation_daily v
    WHERE v.trade_date >= (CURRENT_DATE - INTERVAL '5 years')
    GROUP BY v.symbol
  )
  SELECT p.symbol
  FROM public.tw_industry_peers p
  JOIN cnt ON cnt.symbol = p.symbol
  WHERE p.symbol ~ '^[0-9]{4}$'
    AND p.industry NOT IN ('ETF','ETN','受益證券','存託憑證','指數投資證券(ETN)','所有證券')
    AND cnt.c < _min_rows
    AND cnt.last_fetch < now() - INTERVAL '6 hours'
  ORDER BY p.symbol
  LIMIT GREATEST(_limit, 1)
$function$;

REVOKE ALL ON FUNCTION public.valuation_backfill_targets(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valuation_backfill_targets(integer, integer) TO service_role;