DO $migration$
DECLARE d text;
BEGIN
 d := pg_get_functiondef('public.get_traffic_overview(timestamptz,timestamptz)'::regprocedure);
 d := replace(d,'FROM window_events WHERE event_name = ''auth_signup_success''','FROM public.traffic_events WHERE event_name = ''auth_signup_success''');
 d := replace(d,'FROM window_events e WHERE e.event_name = ''auth_signup_success''','FROM public.traffic_events e WHERE e.event_name = ''auth_signup_success''');
 EXECUTE d;
END;
$migration$;