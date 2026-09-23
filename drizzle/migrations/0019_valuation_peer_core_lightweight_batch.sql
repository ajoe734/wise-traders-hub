-- 0019: 批次同業中位數改走輕量 core（不算 5 年歷史與趨勢）
-- 根因：valuation_peer_medians 逐檔呼叫 valuation_snapshot，後者含 5 年 hist + 月取樣 trend；
-- 持倉 20 檔一次打 → statement timeout。批次端只需要 peers，不需要 history/trend。
CREATE OR REPLACE FUNCTION public.valuation_peer_core(_symbol text)
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
  me AS (
    SELECT m.industries, m.official_industry, m.market, m.market_groups
    FROM public.stock_industry_map m CROSS JOIN sym WHERE m.symbol = sym.s
  ),
  group_pick AS (
    SELECT g.name AS group_name
    FROM unnest(COALESCE((SELECT market_groups FROM me), ARRAY[]::text[])) AS g(name)
    JOIN LATERAL (
      SELECT count(*) AS c FROM public.stock_industry_map m
      WHERE m.market_groups @> ARRAY[g.name]
    ) cnt ON true
    WHERE cnt.c BETWEEN 3 AND 10
    ORDER BY cnt.c ASC, g.name ASC
    LIMIT 1
  ),
  ind AS (
    SELECT
      COALESCE((SELECT industries[1] FROM me),
               (SELECT p.industry FROM public.tw_industry_peers p CROSS JOIN sym WHERE p.symbol = sym.s)) AS industry,
      ((SELECT industries[1] FROM me) IS NOT NULL) AS fine,
      (SELECT official_industry FROM me) AS broad_industry,
      (SELECT group_name FROM group_pick) AS group_name,
      COALESCE((SELECT market FROM me),
               (SELECT p.market FROM public.tw_industry_peers p CROSS JOIN sym WHERE p.symbol = sym.s)) AS market
  ),
  group_syms AS (
    SELECT m.symbol FROM public.stock_industry_map m CROSS JOIN ind CROSS JOIN sym
    WHERE ind.group_name IS NOT NULL AND m.market_groups @> ARRAY[ind.group_name] AND m.symbol <> sym.s
  ),
  fine_syms AS (
    SELECT m.symbol FROM public.stock_industry_map m CROSS JOIN ind CROSS JOIN sym
    WHERE ind.fine AND m.industries[1] = (SELECT industries[1] FROM me) AND m.symbol <> sym.s
      AND (ind.market IS NULL OR m.market IS NULL OR m.market = ind.market)
  ),
  wide_syms AS (
    SELECT m.symbol FROM public.stock_industry_map m CROSS JOIN ind CROSS JOIN sym
    WHERE ind.fine AND m.industries && (SELECT industries FROM me) AND m.symbol <> sym.s
      AND (ind.market IS NULL OR m.market IS NULL OR m.market = ind.market)
  ),
  broad_syms AS (
    SELECT m.symbol FROM public.stock_industry_map m CROSS JOIN ind CROSS JOIN sym
    WHERE ind.broad_industry IS NOT NULL AND m.official_industry = ind.broad_industry AND m.symbol <> sym.s
      AND (ind.market IS NULL OR m.market IS NULL OR m.market = ind.market)
  ),
  legacy_syms AS (
    SELECT p.symbol FROM public.tw_industry_peers p CROSS JOIN ind CROSS JOIN sym
    WHERE NOT ind.fine AND p.industry = ind.industry AND p.symbol <> sym.s
      AND (ind.market IS NULL OR p.market IS NULL OR p.market = ind.market)
  ),
  group_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield FROM group_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1) lv ON true
  ),
  fine_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield FROM fine_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1) lv ON true
  ),
  wide_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield FROM wide_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1) lv ON true
  ),
  broad_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield FROM broad_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1) lv ON true
  ),
  legacy_rows AS (
    SELECT ps.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield FROM legacy_syms ps
    LEFT JOIN public.stock_names n ON n.symbol = ps.symbol
    JOIN LATERAL (SELECT v.per, v.pbr, v.dividend_yield FROM public.tw_valuation_daily v
      WHERE v.symbol = ps.symbol ORDER BY v.trade_date DESC LIMIT 1) lv ON true
  ),
  chosen AS (
    SELECT
      CASE
        WHEN (SELECT count(*) FROM group_rows WHERE per IS NOT NULL OR pbr IS NOT NULL) >= 3 THEN 'group'
        WHEN (SELECT count(*) FROM fine_rows WHERE per IS NOT NULL OR pbr IS NOT NULL) >= 3 THEN 'fine'
        WHEN (SELECT count(*) FROM wide_rows WHERE per IS NOT NULL OR pbr IS NOT NULL) >= 3 THEN 'fineWide'
        WHEN (SELECT count(*) FROM broad_rows WHERE per IS NOT NULL OR pbr IS NOT NULL) >= 3 THEN 'broad'
        WHEN (SELECT count(*) FROM fine_rows) > 0 THEN 'fine'
        WHEN (SELECT count(*) FROM wide_rows) > 0 THEN 'fineWide'
        WHEN (SELECT count(*) FROM legacy_rows) > 0 THEN 'legacy'
        ELSE 'fine'
      END AS scope
  ),
  peer_rows AS (
    SELECT * FROM group_rows WHERE (SELECT scope FROM chosen) = 'group'
    UNION ALL SELECT * FROM fine_rows WHERE (SELECT scope FROM chosen) = 'fine'
    UNION ALL SELECT * FROM wide_rows WHERE (SELECT scope FROM chosen) = 'fineWide'
    UNION ALL SELECT * FROM broad_rows WHERE (SELECT scope FROM chosen) = 'broad'
    UNION ALL SELECT * FROM legacy_rows WHERE (SELECT scope FROM chosen) = 'legacy'
  )
  SELECT jsonb_build_object(
    'symbol', (SELECT s FROM sym),
    'asOf', (SELECT to_char(trade_date, 'YYYY-MM-DD') FROM latest),
    'source', (SELECT source FROM latest),
    'pe', (SELECT per FROM latest),
    'pb', (SELECT pbr FROM latest),
    'dividendYield', (SELECT dividend_yield FROM latest),
    'industry', (SELECT industry FROM ind),
    'marketGroups', COALESCE(to_jsonb((SELECT market_groups FROM me)), '[]'::jsonb),
    'peerScope', (SELECT scope FROM chosen),
    'peerCount', (SELECT count(*) FROM peer_rows),
    'peerIndustry', CASE
                      WHEN (SELECT scope FROM chosen) = 'group' THEN (SELECT group_name FROM ind)
                      WHEN (SELECT scope FROM chosen) = 'broad' THEN (SELECT broad_industry FROM ind)
                      ELSE (SELECT industry FROM ind) END,
    'peers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'pe', per, 'pb', pbr, 'dividendYield', dividend_yield))
      FROM peer_rows), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.valuation_peer_medians(_symbols text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH norm AS (
    SELECT DISTINCT btrim(s) AS symbol
    FROM unnest(COALESCE(_symbols, ARRAY[]::text[])) AS u(s)
    WHERE btrim(s) ~ '^[0-9]{4,6}$'
    LIMIT 50
  ),
  snaps AS (SELECT public.valuation_peer_core(n.symbol) AS snap FROM norm n)
  SELECT COALESCE(jsonb_agg(snap ORDER BY snap->>'symbol'), '[]'::jsonb)
  FROM snaps WHERE snap IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.valuation_peer_core(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valuation_peer_core(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.valuation_peer_medians(text[]) TO anon, authenticated, service_role;