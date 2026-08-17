-- H5 — read-only drawer contract (backing SQL for tw-chips-detail-v2).
-- STABLE + no DML anywhere: a cache miss returns pending/unavailable, it never
-- rebuilds, enqueues or backfills. Additive: one new function, nothing replaced.

CREATE OR REPLACE FUNCTION public.get_chips_detail_ro(p_stock_id text, p_window integer DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH sym AS (SELECT upper(btrim(p_stock_id)) AS s),
  roll AS (
    SELECT r.* FROM public.tw_chips_rollup r, sym
     WHERE r.stock_id = sym.s AND r.window_days = p_window
     ORDER BY r.as_of_date DESC LIMIT 1
  ),
  cov AS (
    SELECT c.* FROM public.bsr_coverage_daily c, sym
     WHERE c.stock_id = sym.s ORDER BY c.trade_date DESC LIMIT 1
  ),
  fresh AS (
    SELECT max(d.trade_date) AS last_trade_date, count(*) AS rows_available
      FROM public.tw_bsr_daily d, sym WHERE d.stock_id = sym.s
  )
  SELECT jsonb_build_object(
    'stock_id', (SELECT s FROM sym),
    'window_days', p_window,
    'state', CASE
               WHEN (SELECT rows_available FROM fresh) = 0 THEN 'pending'
               WHEN NOT EXISTS (SELECT 1 FROM roll) THEN 'pending'
               WHEN (SELECT bsr_available FROM roll) IS NOT TRUE THEN 'unavailable'
               ELSE 'ready'
             END,
    'as_of_date',        (SELECT as_of_date FROM roll),
    'last_trade_date',   (SELECT last_trade_date FROM fresh),
    'coverage_pct',      (SELECT coverage_pct FROM cov),
    'coverage_class',    (SELECT coverage_class FROM cov),
    'foreign_net',       (SELECT foreign_net FROM roll),
    'trust_net',         (SELECT trust_net FROM roll),
    'dealer_net',        (SELECT dealer_net FROM roll),
    'top_buy_brokers',   coalesce((SELECT top_buy_brokers FROM roll), '[]'::jsonb),
    'top_sell_brokers',  coalesce((SELECT top_sell_brokers FROM roll), '[]'::jsonb),
    'low_quality',       coalesce((SELECT low_quality FROM roll), false),
    'fallback_used',     coalesce((SELECT fallback_used FROM roll), false),
    'computed_at',       (SELECT updated_at FROM roll)
  )
$$;

REVOKE ALL ON FUNCTION public.get_chips_detail_ro(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chips_detail_ro(text, integer) TO service_role;
