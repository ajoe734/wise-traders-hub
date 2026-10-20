DO $migration$
DECLARE d text;
BEGIN
 d := pg_get_functiondef('public.get_traffic_overview(timestamptz,timestamptz)'::regprocedure);
 d := replace(d,'SELECT occurred_at,gross_amount,platform_amount,channel,utm_campaign FROM public.conversions','SELECT occurred_at,gross_amount,platform_amount,channel,utm_campaign,utm_source,utm_medium FROM public.conversions');
 d := replace(d,'COALESCE(NULLIF(co.utm_campaign,''''),''(none)'') = g.campaign AND','COALESCE(NULLIF(co.utm_campaign,''''),''(none)'') = g.campaign AND COALESCE(NULLIF(co.utm_source,''''),''(direct)'') = g.source AND COALESCE(NULLIF(co.utm_medium,''''),''(none)'') = g.medium AND');
 EXECUTE d;
END;
$migration$;