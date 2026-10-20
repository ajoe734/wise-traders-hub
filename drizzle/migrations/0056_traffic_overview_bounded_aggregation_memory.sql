ALTER FUNCTION public.get_traffic_overview(timestamptz,timestamptz) SET work_mem TO '32MB';
ALTER FUNCTION public.get_page_analytics(timestamptz,timestamptz,boolean) SET work_mem TO '32MB';