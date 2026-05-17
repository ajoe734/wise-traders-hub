
CREATE TABLE public.perf_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL,
  fcp_ms integer,
  lcp_ms integer,
  user_id uuid,
  session_id text,
  viewport_w integer,
  ua_kind text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.perf_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert perf metrics"
  ON public.perf_metrics FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(route) BETWEEN 1 AND 200
    AND (fcp_ms IS NULL OR fcp_ms BETWEEN 0 AND 120000)
    AND (lcp_ms IS NULL OR lcp_ms BETWEEN 0 AND 120000)
  );

CREATE POLICY "Admins read perf metrics"
  ON public.perf_metrics FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'));

CREATE INDEX idx_perf_metrics_created_at ON public.perf_metrics (created_at DESC);
CREATE INDEX idx_perf_metrics_route_created ON public.perf_metrics (route, created_at DESC);

CREATE OR REPLACE FUNCTION public.cleanup_old_perf_metrics()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.perf_metrics WHERE created_at < now() - INTERVAL '7 days';
$$;

CREATE OR REPLACE FUNCTION public.get_perf_metrics_summary(_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - (_days || ' days')::interval;
  v_daily jsonb;
  v_routes jsonb;
  v_totals jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      (date_trunc('day', created_at AT TIME ZONE 'Asia/Taipei'))::date AS day,
      COUNT(*) AS samples,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fcp_ms))::int AS fcp_p50,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY fcp_ms))::int AS fcp_p95,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lcp_ms))::int AS lcp_p50,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lcp_ms))::int AS lcp_p95
    FROM public.perf_metrics
    WHERE created_at >= v_since
    GROUP BY 1
  ) d;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.samples DESC), '[]'::jsonb)
  INTO v_routes
  FROM (
    SELECT
      route,
      COUNT(*) AS samples,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fcp_ms))::int AS fcp_p50,
      ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY fcp_ms))::int AS fcp_p75,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY fcp_ms))::int AS fcp_p95,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lcp_ms))::int AS lcp_p50,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lcp_ms))::int AS lcp_p95
    FROM public.perf_metrics
    WHERE created_at >= v_since
    GROUP BY route
    LIMIT 200
  ) r;

  SELECT jsonb_build_object(
    'samples', COUNT(*),
    'routes', COUNT(DISTINCT route),
    'fcp_p50', ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fcp_ms))::int,
    'fcp_p95', ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY fcp_ms))::int,
    'lcp_p50', ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lcp_ms))::int,
    'lcp_p95', ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lcp_ms))::int
  )
  INTO v_totals
  FROM public.perf_metrics
  WHERE created_at >= v_since;

  RETURN jsonb_build_object(
    'since', v_since,
    'totals', v_totals,
    'daily', v_daily,
    'routes', v_routes
  );
END;
$$;
