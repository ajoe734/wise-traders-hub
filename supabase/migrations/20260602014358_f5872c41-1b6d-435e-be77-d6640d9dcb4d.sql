
DROP FUNCTION IF EXISTS public.get_event_heatmap(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_event_heatmap(
  _from timestamptz, _to timestamptz
) RETURNS TABLE(event_name text, total_count bigint, unique_visitors bigint, unique_users bigint, last_seen timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
    SELECT
      e.event_name,
      COUNT(*)::bigint,
      COUNT(DISTINCT e.visitor_id)::bigint,
      COUNT(DISTINCT e.user_id)::bigint,
      MAX(e.occurred_at)
    FROM traffic_events e
    WHERE e.occurred_at >= _from AND e.occurred_at < _to
      AND e.event_name IS NOT NULL
      AND NOT e.is_internal
    GROUP BY e.event_name
    ORDER BY COUNT(*) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_funnel_overview(
  _from timestamptz, _to timestamptz, _steps text[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s text;
  prev_visitors bigint := NULL;
  rows jsonb := '[]'::jsonb;
  cur bigint;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOREACH s IN ARRAY _steps LOOP
    SELECT COUNT(DISTINCT visitor_id) INTO cur
    FROM traffic_events
    WHERE occurred_at >= _from AND occurred_at < _to
      AND event_name = s
      AND NOT is_internal;

    rows := rows || jsonb_build_array(jsonb_build_object(
      'step', s,
      'visitors', cur,
      'drop_from_prev', CASE WHEN prev_visitors IS NULL OR prev_visitors = 0 THEN NULL
                             ELSE ROUND(100.0 * (prev_visitors - cur) / prev_visitors, 1) END
    ));
    prev_visitors := cur;
  END LOOP;

  RETURN rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_instruments(
  _from timestamptz, _to timestamptz, _limit int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.events DESC)
    FROM (
      SELECT
        event_props->>'instrument' AS instrument,
        COUNT(*)::bigint AS events,
        COUNT(DISTINCT visitor_id)::bigint AS unique_visitors
      FROM traffic_events
      WHERE occurred_at >= _from AND occurred_at < _to
        AND event_props ? 'instrument'
        AND NOT is_internal
      GROUP BY event_props->>'instrument'
      ORDER BY COUNT(*) DESC
      LIMIT _limit
    ) r
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_page_analytics(
  _from timestamptz, _to timestamptz, _include_internal boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.page_views DESC)
    FROM (
      SELECT
        route AS path,
        COUNT(*)::bigint AS page_views,
        COUNT(DISTINCT visitor_id)::bigint AS unique_visitors,
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::bigint AS logged_in_visitors
      FROM traffic_events
      WHERE occurred_at >= _from AND occurred_at < _to
        AND (_include_internal OR NOT is_internal)
      GROUP BY route
      ORDER BY COUNT(*) DESC
      LIMIT 100
    ) r
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_product_breakdown(
  _from timestamptz, _to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  WITH classified AS (
    SELECT
      visitor_id,
      user_id,
      CASE
        WHEN route LIKE '/holding-checkup%' OR route LIKE '/portfolio%' OR route LIKE '/overview%'
          OR event_name LIKE 'checkup_%' THEN 'checkup'
        WHEN route LIKE '/app%' OR event_name IN ('signal_view','signal_card_click','holdings_dashboard_view','holding_card_click','journal_view','journal_card_click','app_dashboard_view') THEN 'signals'
        WHEN event_name IN ('learning_view','system_detail_view','learning_card_click') THEN 'learning'
        ELSE 'other'
      END AS product
    FROM traffic_events
    WHERE occurred_at >= _from AND occurred_at < _to AND NOT is_internal
  )
  SELECT jsonb_agg(row_to_json(r) ORDER BY r.events DESC)
  INTO v
  FROM (
    SELECT
      product,
      COUNT(*)::bigint AS events,
      COUNT(DISTINCT visitor_id)::bigint AS unique_visitors,
      COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::bigint AS logged_in_visitors
    FROM classified
    WHERE product <> 'other'
    GROUP BY product
  ) r;

  RETURN COALESCE(v, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_journey(
  _visitor_id text, _from timestamptz, _to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.occurred_at)
    FROM (
      SELECT occurred_at, route, event_name, event_props, is_internal
      FROM traffic_events
      WHERE visitor_id = _visitor_id
        AND occurred_at >= _from AND occurred_at < _to
      ORDER BY occurred_at
      LIMIT 500
    ) r
  ), '[]'::jsonb);
END;
$$;
