CREATE TABLE public.traffic_debug_event_daily (
  day date NOT NULL,
  route text NOT NULL,
  event_name text NOT NULL,
  events integer NOT NULL,
  visitors integer NOT NULL,
  first_at timestamptz NOT NULL,
  last_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, route, event_name)
);
GRANT SELECT ON public.traffic_debug_event_daily TO authenticated;
GRANT ALL ON public.traffic_debug_event_daily TO service_role;
ALTER TABLE public.traffic_debug_event_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read debug evidence" ON public.traffic_debug_event_daily
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'::app_role));
COMMENT ON TABLE public.traffic_debug_event_daily IS 'Permanent daily evidence of retired chips_*/holdings_range_band_inconsistency debug events removed from traffic_events.';
INSERT INTO public.traffic_debug_event_daily (day, route, event_name, events, visitors, first_at, last_at)
SELECT (occurred_at AT TIME ZONE 'Asia/Taipei')::date, route, event_name,
       count(*), count(DISTINCT visitor_id), min(occurred_at), max(occurred_at)
FROM public.traffic_events
WHERE event_name LIKE 'chips\_%' OR event_name = 'holdings_range_band_inconsistency'
GROUP BY 1,2,3;