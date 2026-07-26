
-- =====================================================
-- P5-1: Fact-log health views + legacy backfill
-- =====================================================

-- 1) Health view: per-day per-lane counts (last 30 trade days in fact log)
CREATE OR REPLACE VIEW public.chip_fact_health AS
WITH recent_dates AS (
  SELECT DISTINCT trade_date
  FROM public.tw_chip_fact
  ORDER BY trade_date DESC
  LIMIT 30
)
SELECT
  f.trade_date,
  f.source AS lane,
  COUNT(*) AS row_count,
  COUNT(DISTINCT f.stock_id) AS stock_count,
  COUNT(DISTINCT f.broker_id) AS broker_count,
  MAX(f.ingested_at) AS last_ingested_at,
  COALESCE(s.sealed_at IS NOT NULL, false) AS sealed,
  s.sealed_by_lane
FROM public.tw_chip_fact f
JOIN recent_dates rd ON rd.trade_date = f.trade_date
LEFT JOIN public.tw_bsr_daily_snapshot_status s ON s.trade_date = f.trade_date
GROUP BY f.trade_date, f.source, s.sealed_at, s.sealed_by_lane
ORDER BY f.trade_date DESC, f.source;

GRANT SELECT ON public.chip_fact_health TO authenticated, service_role;

-- 2) Conflict view: same (date, stock, broker) with material lane divergence
CREATE OR REPLACE VIEW public.chip_fact_conflicts AS
WITH grp AS (
  SELECT
    trade_date, stock_id, broker_id,
    COUNT(DISTINCT source) AS lane_count,
    MAX(net_shares) AS max_net,
    MIN(net_shares) AS min_net,
    array_agg(DISTINCT source ORDER BY source) AS lanes
  FROM public.tw_chip_fact
  WHERE trade_date >= (CURRENT_DATE - INTERVAL '30 days')::date
  GROUP BY trade_date, stock_id, broker_id
)
SELECT
  trade_date, stock_id, broker_id, lanes, lane_count,
  max_net, min_net, (max_net - min_net) AS net_diff
FROM grp
WHERE lane_count >= 2
  AND ABS(max_net - min_net) >= 1000
ORDER BY trade_date DESC, ABS(max_net - min_net) DESC;

GRANT SELECT ON public.chip_fact_conflicts TO authenticated, service_role;

-- 3) Legacy backfill function
CREATE OR REPLACE FUNCTION public.backfill_legacy_bsr_to_fact(_from date, _to date)
RETURNS TABLE(inserted_rows integer, skipped_rows integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_total int := 0;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Invalid date range: % to %', _from, _to;
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.tw_bsr_daily
  WHERE trade_date BETWEEN _from AND _to;

  -- Bypass immutability trigger (legacy backfill is an authorized reseal)
  PERFORM set_config('app.force_reseal', 'true', true);

  WITH ins AS (
    INSERT INTO public.tw_chip_fact (
      stock_id, trade_date, broker_id, broker_name, source,
      buy_shares, sell_shares, net_shares,
      avg_buy_price, avg_sell_price, ingested_at
    )
    SELECT
      stock_id, trade_date, broker_id, broker_name,
      'legacy_migration'::text,
      buy_shares, sell_shares, net_shares,
      avg_buy_price, avg_sell_price,
      COALESCE(created_at, now())
    FROM public.tw_bsr_daily
    WHERE trade_date BETWEEN _from AND _to
    ON CONFLICT (stock_id, trade_date, broker_id, source) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  PERFORM set_config('app.force_reseal', 'false', true);

  RETURN QUERY SELECT v_inserted, GREATEST(v_total - v_inserted, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_legacy_bsr_to_fact(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_legacy_bsr_to_fact(date, date) TO service_role;

-- 4) Fact-log summary function for the health dashboard (last N days aggregate)
CREATE OR REPLACE FUNCTION public.chip_fact_summary(_days int DEFAULT 20)
RETURNS TABLE(
  total_rows bigint,
  distinct_stocks bigint,
  distinct_days bigint,
  last_fact_at timestamptz,
  broker_scraper_rows bigint,
  finmind_batch_rows bigint,
  finmind_per_stock_rows bigint,
  legacy_migration_rows bigint,
  sealed_days bigint,
  eligible_days bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cutoff AS (
    SELECT (CURRENT_DATE - make_interval(days => _days))::date AS d
  ),
  fact AS (
    SELECT *
    FROM public.tw_chip_fact, cutoff
    WHERE trade_date >= cutoff.d
  ),
  ss AS (
    SELECT trade_date, sealed_at
    FROM public.tw_bsr_daily_snapshot_status, cutoff
    WHERE trade_date >= cutoff.d
  )
  SELECT
    (SELECT COUNT(*) FROM fact),
    (SELECT COUNT(DISTINCT stock_id) FROM fact),
    (SELECT COUNT(DISTINCT trade_date) FROM fact),
    (SELECT MAX(ingested_at) FROM fact),
    (SELECT COUNT(*) FROM fact WHERE source = 'broker_scraper'),
    (SELECT COUNT(*) FROM fact WHERE source = 'finmind_batch'),
    (SELECT COUNT(*) FROM fact WHERE source = 'finmind_per_stock'),
    (SELECT COUNT(*) FROM fact WHERE source = 'legacy_migration'),
    (SELECT COUNT(*) FROM ss WHERE sealed_at IS NOT NULL),
    (SELECT COUNT(*) FROM ss);
$$;

REVOKE ALL ON FUNCTION public.chip_fact_summary(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chip_fact_summary(int) TO authenticated, service_role;
