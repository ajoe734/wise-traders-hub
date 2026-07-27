CREATE TABLE IF NOT EXISTS public.bsr_coverage_daily (
  stock_id text NOT NULL,
  trade_date date NOT NULL,
  broker_count integer NOT NULL DEFAULT 0,
  broker_sum_shares bigint NOT NULL DEFAULT 0,
  snapshot_volume_shares bigint,
  coverage_pct numeric(8,2),
  coverage_class text NOT NULL DEFAULT 'unknown',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stock_id, trade_date)
);

GRANT SELECT ON public.bsr_coverage_daily TO authenticated;
GRANT ALL ON public.bsr_coverage_daily TO service_role;

ALTER TABLE public.bsr_coverage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bsr_coverage_daily_admin_read"
  ON public.bsr_coverage_daily
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE INDEX IF NOT EXISTS idx_bsr_coverage_daily_date ON public.bsr_coverage_daily (trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_bsr_coverage_daily_class ON public.bsr_coverage_daily (coverage_class, trade_date DESC);

CREATE OR REPLACE FUNCTION public.refresh_bsr_coverage_daily(days integer DEFAULT 10)
RETURNS TABLE (rows_upserted integer, date_from date, date_to date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date := (current_date - GREATEST(days, 1))::date;
  v_to   date := current_date;
  v_count integer := 0;
BEGIN
  WITH bsr AS (
    SELECT
      stock_id,
      trade_date,
      COUNT(*)::int AS broker_count,
      COALESCE(SUM(buy_shares), 0)::bigint AS broker_sum_shares
    FROM public.tw_bsr_daily
    WHERE trade_date >= v_from
    GROUP BY stock_id, trade_date
  ),
  joined AS (
    SELECT
      b.stock_id,
      b.trade_date,
      b.broker_count,
      b.broker_sum_shares,
      s.volume_shares AS snapshot_volume_shares,
      CASE
        WHEN s.volume_shares IS NULL OR s.volume_shares = 0 THEN NULL
        ELSE ROUND((b.broker_sum_shares::numeric / s.volume_shares::numeric) * 100, 2)
      END AS coverage_pct
    FROM bsr b
    LEFT JOIN public.daily_price_snapshots s
      ON s.symbol = b.stock_id AND s.trade_date = b.trade_date
  ),
  classified AS (
    SELECT
      j.*,
      CASE
        WHEN snapshot_volume_shares IS NULL THEN 'missing_snapshot'
        WHEN coverage_pct IS NULL THEN 'missing_snapshot'
        WHEN coverage_pct > 120 THEN 'broker_over_cover'
        WHEN coverage_pct < 60 THEN 'broker_under_cover'
        ELSE 'ok'
      END AS coverage_class
    FROM joined j
  ),
  upserted AS (
    INSERT INTO public.bsr_coverage_daily AS t
      (stock_id, trade_date, broker_count, broker_sum_shares, snapshot_volume_shares, coverage_pct, coverage_class, computed_at)
    SELECT stock_id, trade_date, broker_count, broker_sum_shares, snapshot_volume_shares, coverage_pct, coverage_class, now()
    FROM classified
    ON CONFLICT (stock_id, trade_date) DO UPDATE
      SET broker_count = EXCLUDED.broker_count,
          broker_sum_shares = EXCLUDED.broker_sum_shares,
          snapshot_volume_shares = EXCLUDED.snapshot_volume_shares,
          coverage_pct = EXCLUDED.coverage_pct,
          coverage_class = EXCLUDED.coverage_class,
          computed_at = now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_count FROM upserted;

  RETURN QUERY SELECT v_count, v_from, v_to;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_bsr_coverage_daily(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_bsr_coverage_daily(integer) TO service_role;

-- Initial backfill (last 30 days)
SELECT public.refresh_bsr_coverage_daily(30);