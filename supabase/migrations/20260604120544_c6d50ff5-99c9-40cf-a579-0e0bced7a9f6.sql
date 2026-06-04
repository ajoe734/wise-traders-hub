-- Tighten traffic_visits / traffic_events RLS.
-- All writes go through traffic-ingest edge function which uses the service_role
-- client (bypasses RLS). The previous policies allowed any anon/authenticated
-- user to insert/update arbitrary rows, which was a tampering vector for
-- attribution data (UTM, visitor_id, channel, user_id).
DROP POLICY IF EXISTS "Anyone can update own visit by visitor_id" ON public.traffic_visits;
DROP POLICY IF EXISTS "Anyone can insert traffic_visits" ON public.traffic_visits;
DROP POLICY IF EXISTS "Anyone can insert traffic_events" ON public.traffic_events;