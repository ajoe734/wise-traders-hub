DO $migration$
DECLARE definition text; old_daily text; new_daily text;
BEGIN
  definition := pg_get_functiondef('public.get_traffic_overview(timestamptz,timestamptz)'::regprocedure);
  old_daily := substring(definition FROM '  SELECT COALESCE\(jsonb_agg\(row_to_json\(d\).*?  \) d;');
  IF old_daily IS NULL THEN RAISE EXCEPTION 'Expected daily implementation missing'; END IF;
  new_daily := $daily$  WITH days AS (
    SELECT g::date AS day FROM generate_series(date_trunc('day', _from AT TIME ZONE 'Asia/Taipei'),date_trunc('day', (_to-interval '1 microsecond') AT TIME ZONE 'Asia/Taipei'),interval '1 day') g
  ), visits_by_day AS (
    SELECT (first_seen_at AT TIME ZONE 'Asia/Taipei')::date AS day,count(*) AS visitors
    FROM traffic_visits WHERE first_seen_at>=_from AND first_seen_at<_to GROUP BY 1
  ), pages_by_day AS (
    SELECT (occurred_at AT TIME ZONE 'Asia/Taipei')::date AS day,count(*) AS page_views
    FROM traffic_events WHERE event_name='page_view' AND is_internal IS NOT TRUE AND occurred_at>=_from AND occurred_at<_to GROUP BY 1
  ), orders_by_day AS (
    SELECT (occurred_at AT TIME ZONE 'Asia/Taipei')::date AS day,count(*) AS orders,coalesce(sum(gross_amount),0) AS gross
    FROM conversions WHERE occurred_at>=_from AND occurred_at<_to GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.day),'[]'::jsonb) INTO v_daily
  FROM (
    SELECT days.day,coalesce(v.visitors,0) AS visitors,coalesce(p.page_views,0) AS page_views,coalesce(o.orders,0) AS orders,coalesce(o.gross,0) AS gross
    FROM days LEFT JOIN visits_by_day v USING(day) LEFT JOIN pages_by_day p USING(day) LEFT JOIN orders_by_day o USING(day)
  ) d;$daily$;
  definition := replace(definition,old_daily,new_daily);
  definition := replace(definition, 'COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM traffic_events e WHERE e.visitor_id = tv.visitor_id AND e.event_name = ''auth_signup_success'' AND e.is_internal IS NOT TRUE AND e.occurred_at >= _from AND e.occurred_at < _to)) AS signups', 'COUNT(*) FILTER (WHERE tv.visitor_id IN (SELECT e.visitor_id FROM traffic_events e WHERE e.event_name = ''auth_signup_success'' AND e.is_internal IS NOT TRUE AND e.occurred_at >= _from AND e.occurred_at < _to)) AS signups');
  EXECUTE definition;
END;
$migration$;