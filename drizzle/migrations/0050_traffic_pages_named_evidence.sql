CREATE OR REPLACE FUNCTION public.get_page_analytics(_from timestamptz,_to timestamptz,_include_internal boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $function$
BEGIN
 IF NOT has_role(auth.uid(),'company_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.page_views DESC) FROM (
 SELECT route AS path,count(*)::bigint AS page_views,count(DISTINCT visitor_id)::bigint AS unique_visitors,count(DISTINCT user_id) FILTER(WHERE user_id IS NOT NULL)::bigint AS logged_in_visitors
 FROM traffic_events WHERE occurred_at>=_from AND occurred_at<_to AND event_name='page_view' AND (_include_internal OR is_internal IS NOT TRUE)
 GROUP BY route ORDER BY count(*) DESC
 ) r),'[]'::jsonb);
END;
$function$;