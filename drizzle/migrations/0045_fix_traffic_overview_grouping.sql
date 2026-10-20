CREATE OR REPLACE FUNCTION public.get_traffic_overview(_from timestamp with time zone, _to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kpi jsonb;
  v_daily jsonb;
  v_channels jsonb;
  v_campaigns jsonb;
  v_referrers jsonb;
  v_landings jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT jsonb_build_object(
    'visitors', (SELECT COUNT(*) FROM traffic_visits WHERE first_seen_at >= _from AND first_seen_at < _to),
    'returning_visitors', (SELECT COUNT(*) FROM traffic_visits WHERE last_seen_at >= _from AND last_seen_at < _to AND first_seen_at < _from),
    'page_views', (SELECT COUNT(*) FROM traffic_events WHERE event_name = 'page_view' AND occurred_at >= _from AND occurred_at < _to),
    'signups', (SELECT COUNT(*) FROM traffic_visits WHERE user_id IS NOT NULL AND first_seen_at >= _from AND first_seen_at < _to),
    'orders', (SELECT COUNT(*) FROM conversions WHERE occurred_at >= _from AND occurred_at < _to),
    'gross', COALESCE((SELECT SUM(gross_amount) FROM conversions WHERE occurred_at >= _from AND occurred_at < _to), 0),
    'platform', COALESCE((SELECT SUM(platform_amount) FROM conversions WHERE occurred_at >= _from AND occurred_at < _to), 0)
  ) INTO v_kpi;

  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      (date_trunc('day', g) AT TIME ZONE 'Asia/Taipei')::date AS day,
      (SELECT COUNT(*) FROM traffic_visits WHERE first_seen_at >= g AND first_seen_at < g + interval '1 day') AS visitors,
      (SELECT COUNT(*) FROM traffic_events WHERE event_name = 'page_view' AND occurred_at >= g AND occurred_at < g + interval '1 day') AS page_views,
      (SELECT COUNT(*) FROM conversions WHERE occurred_at >= g AND occurred_at < g + interval '1 day') AS orders,
      COALESCE((SELECT SUM(gross_amount) FROM conversions WHERE occurred_at >= g AND occurred_at < g + interval '1 day'), 0) AS gross
    FROM generate_series(date_trunc('day', _from), date_trunc('day', _to), interval '1 day') g
  ) d;

  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.visitors DESC), '[]'::jsonb)
  INTO v_channels
  FROM (
    SELECT
      channel,
      COUNT(*) AS visitors,
      (SELECT COUNT(*) FROM conversions co WHERE co.channel = tv.channel AND co.occurred_at >= _from AND co.occurred_at < _to) AS orders,
      (SELECT COALESCE(SUM(gross_amount),0) FROM conversions co WHERE co.channel = tv.channel AND co.occurred_at >= _from AND co.occurred_at < _to) AS gross
    FROM traffic_visits tv
    WHERE first_seen_at >= _from AND first_seen_at < _to
    GROUP BY channel
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.gross DESC NULLS LAST, c.visitors DESC), '[]'::jsonb)
  INTO v_campaigns
  FROM (
    SELECT g.campaign, g.source, g.medium, g.visitors, g.signups,
      (SELECT COUNT(*) FROM conversions co WHERE COALESCE(NULLIF(co.utm_campaign,''),'(none)') = g.campaign AND co.occurred_at >= _from AND co.occurred_at < _to) AS orders,
      (SELECT COALESCE(SUM(gross_amount),0) FROM conversions co WHERE COALESCE(NULLIF(co.utm_campaign,''),'(none)') = g.campaign AND co.occurred_at >= _from AND co.occurred_at < _to) AS gross
    FROM (
      SELECT
        COALESCE(NULLIF(tv.utm_campaign,''), '(none)') AS campaign,
        COALESCE(NULLIF(tv.utm_source,''), '(direct)') AS source,
        COALESCE(NULLIF(tv.utm_medium,''), '(none)') AS medium,
        COUNT(*) AS visitors,
        COUNT(*) FILTER (WHERE tv.user_id IS NOT NULL) AS signups
      FROM traffic_visits tv
      WHERE first_seen_at >= _from AND first_seen_at < _to
      GROUP BY 1, 2, 3
    ) g
    LIMIT 100
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.visitors DESC), '[]'::jsonb)
  INTO v_referrers
  FROM (
    SELECT COALESCE(NULLIF(first_referrer_host,''), '(direct)') AS host, COUNT(*) AS visitors
    FROM traffic_visits
    WHERE first_seen_at >= _from AND first_seen_at < _to
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 20
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(l) ORDER BY l.visitors DESC), '[]'::jsonb)
  INTO v_landings
  FROM (
    SELECT COALESCE(NULLIF(first_landing_path,''), '/') AS path, COUNT(*) AS visitors
    FROM traffic_visits
    WHERE first_seen_at >= _from AND first_seen_at < _to
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 20
  ) l;

  RETURN jsonb_build_object(
    'kpi', v_kpi,
    'daily', v_daily,
    'channels', v_channels,
    'campaigns', v_campaigns,
    'referrers', v_referrers,
    'landings', v_landings
  );
END;
$function$;