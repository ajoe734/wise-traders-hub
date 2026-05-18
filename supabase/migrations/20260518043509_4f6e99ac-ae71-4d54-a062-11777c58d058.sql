ALTER TABLE public.perf_metrics
  ADD COLUMN IF NOT EXISTS inp_ms integer,
  ADD COLUMN IF NOT EXISTS cls_score numeric(6,4);

DROP POLICY IF EXISTS "Anyone can insert perf metrics" ON public.perf_metrics;
CREATE POLICY "Anyone can insert perf metrics"
  ON public.perf_metrics FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(route) BETWEEN 1 AND 200
    AND (fcp_ms IS NULL OR fcp_ms BETWEEN 0 AND 120000)
    AND (lcp_ms IS NULL OR lcp_ms BETWEEN 0 AND 120000)
    AND (inp_ms IS NULL OR inp_ms BETWEEN 0 AND 60000)
    AND (cls_score IS NULL OR cls_score BETWEEN 0 AND 10)
  );

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
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lcp_ms))::int AS lcp_p95,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inp_ms))::int AS inp_p50,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY inp_ms))::int AS inp_p95,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cls_score))::numeric(6,4) AS cls_p50,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cls_score))::numeric(6,4) AS cls_p95
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
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lcp_ms))::int AS lcp_p95,
      ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY inp_ms))::int AS inp_p75,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY inp_ms))::int AS inp_p95,
      ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cls_score))::numeric(6,4) AS cls_p75
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
    'lcp_p95', ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lcp_ms))::int,
    'inp_p75', ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY inp_ms))::int,
    'inp_p95', ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY inp_ms))::int,
    'cls_p75', ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cls_score))::numeric(6,4),
    'cls_p95', ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cls_score))::numeric(6,4)
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