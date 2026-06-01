-- 1. Extend traffic_events with named-event columns
ALTER TABLE public.traffic_events
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS event_props jsonb;

CREATE INDEX IF NOT EXISTS traffic_events_event_name_idx
  ON public.traffic_events(event_name, occurred_at DESC)
  WHERE event_name IS NOT NULL;

-- 2. Funnel RPC: count distinct visitors per step in order
CREATE OR REPLACE FUNCTION public.get_funnel_overview(
  _from timestamptz,
  _to timestamptz,
  _steps text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '[]'::jsonb;
  step text;
  cnt bigint;
  prev bigint := NULL;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOREACH step IN ARRAY _steps LOOP
    SELECT count(DISTINCT visitor_id) INTO cnt
    FROM public.traffic_events
    WHERE event_name = step
      AND occurred_at >= _from
      AND occurred_at < _to;

    result := result || jsonb_build_object(
      'step', step,
      'visitors', cnt,
      'drop_from_prev', CASE WHEN prev IS NULL OR prev = 0 THEN NULL
                             ELSE round(((prev - cnt)::numeric / prev) * 100, 2)
                        END
    );
    prev := cnt;
  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_funnel_overview(timestamptz, timestamptz, text[]) TO authenticated;

-- 3. Event heatmap RPC: per-event totals, unique visitors, unique users
CREATE OR REPLACE FUNCTION public.get_event_heatmap(
  _from timestamptz,
  _to timestamptz
) RETURNS TABLE (
  event_name text,
  total_count bigint,
  unique_visitors bigint,
  unique_users bigint,
  last_seen timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    te.event_name,
    count(*)::bigint AS total_count,
    count(DISTINCT te.visitor_id)::bigint AS unique_visitors,
    count(DISTINCT te.user_id)::bigint AS unique_users,
    max(te.occurred_at) AS last_seen
  FROM public.traffic_events te
  WHERE te.event_name IS NOT NULL
    AND te.occurred_at >= _from
    AND te.occurred_at < _to
  GROUP BY te.event_name
  ORDER BY total_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_heatmap(timestamptz, timestamptz) TO authenticated;

-- 4. Health snapshot RPC: total counts + last-write timestamps for the page
CREATE OR REPLACE FUNCTION public.get_traffic_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  visits_total bigint;
  events_total bigint;
  named_events_total bigint;
  last_visit timestamptz;
  last_event timestamptz;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*), max(last_seen_at) INTO visits_total, last_visit
    FROM public.traffic_visits;
  SELECT count(*), max(occurred_at) INTO events_total, last_event
    FROM public.traffic_events;
  SELECT count(*) INTO named_events_total
    FROM public.traffic_events WHERE event_name IS NOT NULL;

  RETURN jsonb_build_object(
    'visits_total', visits_total,
    'events_total', events_total,
    'named_events_total', named_events_total,
    'last_visit_at', last_visit,
    'last_event_at', last_event
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_traffic_health() TO authenticated;