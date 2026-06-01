REVOKE EXECUTE ON FUNCTION public.get_funnel_overview(timestamptz, timestamptz, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_event_heatmap(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_traffic_health() FROM PUBLIC, anon;