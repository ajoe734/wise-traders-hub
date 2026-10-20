DO $migration$
DECLARE d text;
BEGIN
 d := pg_get_functiondef('public.get_traffic_overview(timestamptz,timestamptz)'::regprocedure);
 d := replace(d,'WHERE (first_seen_at >= _from AND first_seen_at < _to) OR (last_seen_at >= _from AND last_seen_at < _to AND first_seen_at < _from)','WHERE first_seen_at >= _from AND first_seen_at < _to');
 d := replace(d,'FROM window_visits WHERE last_seen_at >= _from AND last_seen_at < _to AND first_seen_at < _from','FROM public.traffic_visits WHERE last_seen_at >= _from AND last_seen_at < _to AND first_seen_at < _from');
 d := replace(d,'SELECT visitor_id,event_name,occurred_at,is_internal FROM public.traffic_events WHERE occurred_at >= _from AND occurred_at < _to AND event_name IN (''page_view'',''auth_signup_success'') AND is_internal IS NOT TRUE','SELECT visitor_id,''page_view''::text AS event_name,occurred_at,false AS is_internal FROM public.traffic_events WHERE occurred_at >= _from AND occurred_at < _to AND event_name=''page_view'' AND is_internal IS NOT TRUE UNION ALL SELECT visitor_id,''auth_signup_success''::text AS event_name,occurred_at,false AS is_internal FROM public.traffic_events WHERE occurred_at >= _from AND occurred_at < _to AND event_name=''auth_signup_success'' AND is_internal IS NOT TRUE');
 EXECUTE d;
END;
$migration$;