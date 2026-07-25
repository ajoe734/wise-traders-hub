
CREATE OR REPLACE FUNCTION public.get_publish_batch_status()
RETURNS TABLE (
  expert_id uuid,
  expert_name text,
  expert_slug text,
  market text,
  asset_class text,
  pending_count integer,
  published_this_week integer,
  failed_pending_count integer,
  last_attempt_at timestamptz,
  last_error_kind text,
  last_error_msg text,
  last_error_signal_id uuid,
  last_run_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH us_classes AS (
    SELECT unnest(ARRAY['us_stock','us_futures','crypto']) AS c
  ),
  base AS (
    SELECT e.id, e.name, e.expert_slug, e.asset_class,
           CASE WHEN lower(e.asset_class) IN (SELECT c FROM us_classes)
                THEN 'US' ELSE 'TW' END AS mk
    FROM public.experts e
  ),
  sig_stats AS (
    SELECT s.expert_id,
           count(*) FILTER (WHERE s.status='pending')::int AS pending_count,
           count(*) FILTER (
             WHERE s.status='published'
               AND s.updated_at >= now() - interval '7 days'
           )::int AS published_this_week
    FROM public.expert_signals s
    WHERE s.updated_at >= now() - interval '14 days' OR s.status='pending'
    GROUP BY s.expert_id
  ),
  err_logs AS (
    SELECT l.expert_id, l.signal_id, l.msg, l.run_id, l.created_at,
           l.payload->>'kind' AS kind
    FROM public.function_run_logs l
    WHERE l.fn='publish-weekly-journals'
      AND l.stage='mark_published_iter'
      AND l.level='error'
      AND l.expert_id IS NOT NULL
      AND l.created_at >= now() - interval '14 days'
  ),
  latest_err AS (
    SELECT DISTINCT ON (expert_id)
           expert_id, created_at AS last_attempt_at, kind AS last_error_kind,
           msg AS last_error_msg, signal_id AS last_error_signal_id, run_id AS last_run_id
    FROM err_logs
    ORDER BY expert_id, created_at DESC
  ),
  failed_pending AS (
    SELECT el.expert_id, count(DISTINCT el.signal_id)::int AS cnt
    FROM err_logs el
    JOIN public.expert_signals s ON s.id = el.signal_id AND s.status='pending'
    GROUP BY el.expert_id
  )
  SELECT b.id, b.name, b.expert_slug, b.mk, b.asset_class,
         COALESCE(ss.pending_count,0),
         COALESCE(ss.published_this_week,0),
         COALESCE(fp.cnt,0),
         le.last_attempt_at, le.last_error_kind, le.last_error_msg,
         le.last_error_signal_id, le.last_run_id
  FROM base b
  LEFT JOIN sig_stats ss ON ss.expert_id = b.id
  LEFT JOIN latest_err le ON le.expert_id = b.id
  LEFT JOIN failed_pending fp ON fp.expert_id = b.id
  WHERE COALESCE(ss.pending_count,0) > 0
     OR COALESCE(ss.published_this_week,0) > 0
     OR le.last_attempt_at IS NOT NULL
  ORDER BY b.mk, b.name;
END $$;

REVOKE ALL ON FUNCTION public.get_publish_batch_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_publish_batch_status() TO authenticated;


CREATE OR REPLACE FUNCTION public.get_publish_batch_runs(_limit int DEFAULT 20)
RETURNS TABLE(
  run_id text,
  started_at timestamptz,
  ended_at timestamptz,
  market text,
  pending_found integer,
  published integer,
  failed integer,
  pushed integer,
  push_fail integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT l.run_id, l.created_at, l.stage, l.msg
    FROM public.function_run_logs l
    WHERE l.fn='publish-weekly-journals'
      AND l.created_at >= now() - interval '14 days'
  ),
  runs AS (
    SELECT run_id,
           min(created_at) AS started_at,
           max(created_at) AS ended_at,
           max(CASE WHEN stage='filter_by_market' THEN split_part(msg,' ',3) END) AS market_raw,
           max(CASE WHEN stage='fetch_pending_signals'
                    THEN (regexp_matches(msg,'Found (\d+)'))[1]::int END) AS pending_found,
           max(CASE WHEN stage='mark_published'
                    THEN (regexp_matches(msg,'Published (\d+)/'))[1]::int END) AS published,
           max(CASE WHEN stage='mark_published'
                    THEN (regexp_matches(msg,'failed=(\d+)'))[1]::int END) AS failed,
           max(CASE WHEN stage='line_push'
                    THEN (regexp_matches(msg,'pushed=(\d+)'))[1]::int END) AS pushed,
           max(CASE WHEN stage='line_push'
                    THEN (regexp_matches(msg,'pushFail=(\d+)'))[1]::int END) AS push_fail
    FROM src
    GROUP BY run_id
  )
  SELECT r.run_id, r.started_at, r.ended_at,
         CASE WHEN r.market_raw ILIKE 'US%' THEN 'US'
              WHEN r.market_raw ILIKE 'TW%' THEN 'TW'
              ELSE 'ALL' END,
         COALESCE(r.pending_found,0),
         COALESCE(r.published,0),
         COALESCE(r.failed,0),
         COALESCE(r.pushed,0),
         COALESCE(r.push_fail,0)
  FROM runs r
  ORDER BY r.started_at DESC
  LIMIT _limit;
END $$;

REVOKE ALL ON FUNCTION public.get_publish_batch_runs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_publish_batch_runs(int) TO authenticated;
