
-- 1) Extend tw_chips_rollup with per-day facts (only meaningful when window_days=5)
ALTER TABLE public.tw_chips_rollup
  ADD COLUMN IF NOT EXISTS broker_count integer,
  ADD COLUMN IF NOT EXISTS low_quality boolean;

-- 2) One-off backfill: compute broker_count/low_quality from tw_bsr_daily
--    Only write onto window_days=5 rows (the "today's snapshot" carrier).
WITH per_day AS (
  SELECT stock_id, trade_date,
         COUNT(DISTINCT broker_id) AS bc
    FROM public.tw_bsr_daily
   GROUP BY stock_id, trade_date
)
UPDATE public.tw_chips_rollup r
   SET broker_count = per_day.bc,
       low_quality  = (per_day.bc < 5)
  FROM per_day
 WHERE r.stock_id  = per_day.stock_id
   AND r.as_of_date = per_day.trade_date
   AND r.window_days = 5;

-- 3) RPC: read the daily concentration series for a single stock.
--    Frontend / edge function calls this ONLY — no raw broker fetch on read path.
CREATE OR REPLACE FUNCTION public.get_bsr_daily_series(
  _stock_id text,
  _days int DEFAULT 60
)
RETURNS TABLE (
  trade_date date,
  concentration_ratio numeric,
  broker_count integer,
  low_quality boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.as_of_date,
         r.concentration_ratio,
         r.broker_count,
         COALESCE(r.low_quality, false)
    FROM public.tw_chips_rollup r
   WHERE r.stock_id  = _stock_id
     AND r.window_days = 5
     AND r.bsr_available = true
   ORDER BY r.as_of_date DESC
   LIMIT GREATEST(1, LEAST(_days, 400));
$$;

GRANT EXECUTE ON FUNCTION public.get_bsr_daily_series(text, int) TO authenticated, service_role;

-- 4) Companion RPC: single roundtrip readiness derived from the same source
--    of truth (avoids the "series says 5, readiness says 2" split-brain).
CREATE OR REPLACE FUNCTION public.get_bsr_readiness_v2(_stock_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  valid_dates date[];
  exhausted boolean := false;
  oldest date;
  newest date;
  have int;
  low_q int;
  result jsonb := '{}'::jsonb;
  win int;
BEGIN
  SELECT ARRAY(
    SELECT as_of_date FROM public.tw_chips_rollup
     WHERE stock_id = _stock_id AND window_days = 5
       AND bsr_available = true AND COALESCE(broker_count, 0) >= 1
     ORDER BY as_of_date ASC
  ) INTO valid_dates;

  SELECT COALESCE(p.exhausted, false) INTO exhausted
    FROM public.tw_bsr_upstream_probe p
   WHERE p.stock_id = _stock_id;

  have := COALESCE(array_length(valid_dates, 1), 0);
  oldest := CASE WHEN have > 0 THEN valid_dates[1] END;
  newest := CASE WHEN have > 0 THEN valid_dates[have] END;

  SELECT COUNT(*) INTO low_q
    FROM public.tw_chips_rollup
   WHERE stock_id = _stock_id AND window_days = 5
     AND low_quality = true AND bsr_available = true;

  FOREACH win IN ARRAY ARRAY[5,20,60] LOOP
    result := result || jsonb_build_object(win::text, jsonb_build_object(
      'window_days', win,
      'have', have,
      'need', win,
      'state', CASE
        WHEN have = 0 AND exhausted THEN 'upstream_exhausted'
        WHEN have = 0 THEN 'no_data'
        WHEN have >= win THEN 'ready'
        WHEN exhausted THEN 'upstream_exhausted'
        ELSE 'filling'
      END,
      'oldest_available', oldest,
      'newest_available', newest,
      'low_quality_count', low_q
    ));
  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bsr_readiness_v2(text) TO authenticated, service_role;
