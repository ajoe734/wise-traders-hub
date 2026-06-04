-- Traffic admin RPCs: revoke anon. Internal has_role guard still rejects non-admin authenticated callers.
REVOKE EXECUTE ON FUNCTION public.get_traffic_overview(timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_funnel_overview(timestamptz, timestamptz, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_event_heatmap(timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_product_breakdown(timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_page_analytics(timestamptz, timestamptz, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_top_instruments(timestamptz, timestamptz, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_traffic_health() FROM anon;

-- Quota check: only meaningful for authenticated users.
REVOKE EXECUTE ON FUNCTION public.check_checkup_quota(uuid) FROM anon;

-- Server-only helper used solely by traffic-ingest edge function (service_role).
REVOKE EXECUTE ON FUNCTION public.derive_traffic_channel(text, text, text) FROM anon, authenticated;