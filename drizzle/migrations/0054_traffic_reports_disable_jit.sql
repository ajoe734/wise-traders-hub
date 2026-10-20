ALTER FUNCTION public.get_traffic_overview(timestamptz,timestamptz) SET jit TO off;
ALTER FUNCTION public.get_page_analytics(timestamptz,timestamptz,boolean) SET jit TO off;