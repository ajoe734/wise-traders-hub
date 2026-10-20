DO $migration$
DECLARE definition text; body text; statement text; variable text; queries text := ''; combined text; start_at integer; end_at integer;
BEGIN
 definition := pg_get_functiondef('public.get_traffic_overview(timestamptz,timestamptz)'::regprocedure);
 start_at := strpos(definition,'  SELECT jsonb_build_object('); end_at := strpos(definition,'  RETURN jsonb_build_object(');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Expected overview body missing'; END IF;
 body := substring(definition FROM start_at FOR end_at-start_at);
 FOREACH statement IN ARRAY string_to_array(body,';') LOOP
  IF statement ~ '^[[:space:]]*$' THEN CONTINUE; END IF;
  variable := substring(statement FROM 'INTO[[:space:]]+(v_[a-z]+)');
  IF variable IS NULL THEN RAISE EXCEPTION 'Missing overview variable: %',left(statement,100); END IF;
  statement := regexp_replace(statement,'INTO[[:space:]]+v_[a-z]+','');
  statement := regexp_replace(statement,'\mtraffic_visits\M','window_visits','g');
  statement := regexp_replace(statement,'\mtraffic_events\M','window_events','g');
  statement := regexp_replace(statement,'\mconversions\M','window_orders','g');
  queries := queries || ', ' || variable || '_query AS (' || statement || ')';
 END LOOP;
 combined := '  WITH window_visits AS MATERIALIZED (
  SELECT visitor_id,first_seen_at,last_seen_at,channel,utm_campaign,utm_source,utm_medium,first_referrer_host,first_landing_path FROM public.traffic_visits
  WHERE (first_seen_at >= _from AND first_seen_at < _to) OR (last_seen_at >= _from AND last_seen_at < _to AND first_seen_at < _from)
 ), window_events AS MATERIALIZED (
  SELECT visitor_id,event_name,occurred_at,is_internal FROM public.traffic_events WHERE occurred_at >= _from AND occurred_at < _to AND event_name IN (''page_view'',''auth_signup_success'') AND is_internal IS NOT TRUE
 ), window_orders AS MATERIALIZED (
  SELECT occurred_at,gross_amount,platform_amount,channel,utm_campaign FROM public.conversions WHERE occurred_at >= _from AND occurred_at < _to
 )' || queries || '
 SELECT jsonb_build_object(''kpi'',(SELECT * FROM v_kpi_query),''daily'',(SELECT * FROM v_daily_query),''channels'',(SELECT * FROM v_channels_query),''campaigns'',(SELECT * FROM v_campaigns_query),''referrers'',(SELECT * FROM v_referrers_query),''landings'',(SELECT * FROM v_landings_query)) INTO v_result;
';
 definition := replace(definition,body,combined);
 definition := replace(definition,'  v_kpi jsonb;','  v_result jsonb;' || chr(10) || '  v_kpi jsonb;');
 start_at := strpos(definition,'  RETURN jsonb_build_object('); end_at := strpos(substring(definition FROM start_at),');');
 definition := overlay(definition placing '  RETURN v_result;' FROM start_at FOR end_at+1);
 EXECUTE definition;
END;
$migration$;