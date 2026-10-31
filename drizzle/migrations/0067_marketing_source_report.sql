ALTER TABLE public.referral_attributions ADD COLUMN IF NOT EXISTS first_touch_at timestamptz;
ALTER TABLE public.conversions ADD COLUMN IF NOT EXISTS first_touch_at timestamptz;

CREATE TABLE IF NOT EXISTS public.event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  user_id uuid,
  visitor_id text,
  utm_source text NOT NULL DEFAULT 'direct',
  utm_medium text NOT NULL DEFAULT 'direct',
  utm_campaign text NOT NULL DEFAULT 'direct',
  utm_content text NOT NULL DEFAULT 'direct',
  first_touch_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_registrations_created ON public.event_registrations(created_at);
GRANT INSERT ON public.event_registrations TO anon, authenticated;
GRANT SELECT ON public.event_registrations TO authenticated;
GRANT ALL ON public.event_registrations TO service_role;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can register for events" ON public.event_registrations FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "Admins read registrations" ON public.event_registrations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::app_role));

CREATE OR REPLACE FUNCTION public.validate_event_registration() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $f$
BEGIN
  NEW.event_slug := btrim(NEW.event_slug); NEW.name := btrim(NEW.name); NEW.email := lower(btrim(NEW.email));
  IF NEW.event_slug !~ '^[a-z0-9-]{1,80}$' THEN RAISE EXCEPTION 'invalid event'; END IF;
  IF length(NEW.name) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid name'; END IF;
  IF length(NEW.email) > 255 OR NEW.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid email'; END IF;
  IF NEW.phone IS NOT NULL AND length(NEW.phone) > 30 THEN RAISE EXCEPTION 'invalid phone'; END IF;
  NEW.utm_source := left(coalesce(nullif(btrim(NEW.utm_source),''),'direct'),200);
  NEW.utm_medium := left(coalesce(nullif(btrim(NEW.utm_medium),''),'direct'),200);
  NEW.utm_campaign := left(coalesce(nullif(btrim(NEW.utm_campaign),''),'direct'),200);
  NEW.utm_content := left(coalesce(nullif(btrim(NEW.utm_content),''),'direct'),200);
  NEW.created_at := now();
  RETURN NEW;
END; $f$;
CREATE TRIGGER validate_event_registration BEFORE INSERT ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public.validate_event_registration();

-- 行銷來源報表：只回彙總，無個資
CREATE OR REPLACE FUNCTION public.get_marketing_source_report(_from timestamptz, _to timestamptz)
RETURNS TABLE(utm_medium text, utm_campaign text, utm_content text, visitors bigint, signups bigint, purchases bigint, revenue bigint, leads bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET statement_timeout='30s' AS $f$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  WITH v AS (
    SELECT coalesce(nullif(t.utm_medium,''),'direct') m, coalesce(nullif(t.utm_campaign,''),'direct') c, coalesce(nullif(t.utm_content,''),'direct') ct, count(DISTINCT t.visitor_id) n
    FROM traffic_visits t WHERE t.first_seen_at >= _from AND t.first_seen_at < _to GROUP BY 1,2,3
  ), u AS (
    SELECT au.id FROM auth.users au WHERE au.created_at >= _from AND au.created_at < _to
  ), ua AS (
    SELECT coalesce(nullif(coalesce(ra.utm_medium, tv.utm_medium),''),'direct') m,
           coalesce(nullif(coalesce(ra.utm_campaign, tv.utm_campaign),''),'direct') c,
           coalesce(nullif(coalesce(ra.utm_content, tv.utm_content),''),'direct') ct
    FROM u
    LEFT JOIN LATERAL (SELECT r.utm_medium, r.utm_campaign, r.utm_content FROM referral_attributions r WHERE r.user_id=u.id ORDER BY coalesce(r.first_touch_at, r.created_at) LIMIT 1) ra ON true
    LEFT JOIN LATERAL (SELECT x.utm_medium, x.utm_campaign, x.utm_content FROM traffic_visits x WHERE x.user_id=u.id AND x.utm_source IS NOT NULL ORDER BY x.first_seen_at LIMIT 1) tv ON ra.utm_medium IS NULL AND ra.utm_campaign IS NULL AND ra.utm_content IS NULL
  ), s AS (SELECT m,c,ct,count(*) n FROM ua GROUP BY 1,2,3
  ), p AS (
    SELECT coalesce(nullif(cv.utm_medium,''),'direct') m, coalesce(nullif(cv.utm_campaign,''),'direct') c, coalesce(nullif(cv.utm_content,''),'direct') ct, count(*) n, coalesce(sum(cv.gross_amount),0)::bigint g
    FROM conversions cv WHERE cv.occurred_at >= _from AND cv.occurred_at < _to GROUP BY 1,2,3
  ), l AS (
    SELECT e.utm_medium m, e.utm_campaign c, e.utm_content ct, count(*) n FROM event_registrations e WHERE e.created_at >= _from AND e.created_at < _to GROUP BY 1,2,3
  ), k AS (SELECT m,c,ct FROM v UNION SELECT m,c,ct FROM s UNION SELECT m,c,ct FROM p UNION SELECT m,c,ct FROM l)
  SELECT k.m, k.c, k.ct, coalesce(v.n,0), coalesce(s.n,0), coalesce(p.n,0), coalesce(p.g,0), coalesce(l.n,0)
  FROM k LEFT JOIN v USING (m,c,ct) LEFT JOIN s USING (m,c,ct) LEFT JOIN p USING (m,c,ct) LEFT JOIN l USING (m,c,ct)
  ORDER BY coalesce(p.g,0) DESC, coalesce(v.n,0) DESC;
END; $f$;
REVOKE ALL ON FUNCTION public.get_marketing_source_report(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketing_source_report(timestamptz,timestamptz) TO authenticated;

-- 轉換中心：資料庫端彙總
CREATE OR REPLACE FUNCTION public.get_conversion_center(_since timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET statement_timeout='30s' AS $f$
DECLARE funnel jsonb; attr jsonb; top jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH steps(k, ord, names) AS (VALUES
    ('page_view',1,ARRAY['page_view']), ('pricing_view',2,ARRAY['pricing_view']),
    ('checkout_open',3,ARRAY['checkout_open','checkout_submit']), ('checkout_submit',4,ARRAY['checkout_submit']),
    ('checkout_success',5,ARRAY['checkout_success']))
  SELECT jsonb_agg(jsonb_build_object('key',k,'visitors',vis,'events',evs) ORDER BY ord) INTO funnel FROM (
    SELECT s.k, s.ord, (SELECT count(DISTINCT e.visitor_id) FROM traffic_events e WHERE e.event_name = ANY(s.names) AND e.occurred_at >= _since AND (s.k <> 'page_view' OR e.is_internal IS NOT TRUE)) vis,
      (SELECT count(*) FROM traffic_events e WHERE e.event_name = ANY(s.names) AND e.occurred_at >= _since AND (s.k <> 'page_view' OR e.is_internal IS NOT TRUE)) evs
    FROM steps s) q;
  SELECT coalesce(jsonb_agg(row_to_json(a) ORDER BY a.gross DESC),'[]') INTO attr FROM (
    SELECT coalesce(nullif(utm_source,''), channel, '(direct)') source, coalesce(nullif(utm_medium,''),'direct') medium,
           coalesce(nullif(utm_content,''),'') content, coalesce(nullif(utm_campaign,''),'') campaign, count(*) count, coalesce(sum(gross_amount),0) gross
    FROM conversions WHERE occurred_at >= _since GROUP BY 1,2,3,4) a;
  SELECT coalesce(jsonb_agg(jsonb_build_array(user_id, n) ORDER BY n DESC),'[]') INTO top FROM (
    SELECT user_id, count(*) n FROM traffic_events WHERE user_id IS NOT NULL AND occurred_at >= _since
      AND event_name IN ('pricing_view','checkout_open','checkout_submit','checkout_success')
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15) t;
  RETURN jsonb_build_object('funnel', funnel, 'attribution', attr, 'top_users', top);
END; $f$;
REVOKE ALL ON FUNCTION public.get_conversion_center(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversion_center(timestamptz) TO authenticated;

-- 依序子集漏斗（/company/funnel），與 computeFunnel 相同語意
CREATE OR REPLACE FUNCTION public.get_sequential_funnel(_since timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET statement_timeout='30s' AS $f$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH te AS (
    SELECT event_name, user_id, visitor_id, occurred_at FROM traffic_events
    WHERE occurred_at >= _since AND event_name IN ('pricing_view','expert_profile_view','app_pricing_view','checkup_upgrade_click','checkout_open','checkout_submit','checkout_success')
  ), pw AS (
    SELECT user_id, visitor_id, created_at FROM paywall_events WHERE event_kind='click_upgrade' AND created_at >= _since
  ), links AS (
    SELECT visitor_id, user_id FROM traffic_visits WHERE user_id IS NOT NULL AND last_seen_at >= _since
    UNION ALL SELECT visitor_id, user_id FROM te WHERE user_id IS NOT NULL
    UNION ALL SELECT visitor_id, user_id FROM pw WHERE user_id IS NOT NULL AND visitor_id IS NOT NULL
  ), idx AS (SELECT visitor_id, (array_agg(user_id))[1] user_id FROM links GROUP BY 1
  ), ev AS (
    SELECT CASE WHEN event_name IN ('pricing_view','expert_profile_view','app_pricing_view') THEN 'view_pricing'
                WHEN event_name='checkup_upgrade_click' THEN 'upgrade_click' ELSE 'begin_checkout' END stage,
           CASE WHEN event_name='checkup_upgrade_click' THEN 'traffic_events' ELSE event_name END source, user_id, visitor_id, occurred_at at
      FROM te WHERE event_name <> 'checkout_success'
    UNION ALL SELECT 'upgrade_click','paywall_events', user_id, visitor_id, created_at FROM pw
    UNION ALL SELECT 'purchase','payment_intents', user_id, NULL, coalesce(completed_at, created_at) FROM payment_intents WHERE status='completed' AND created_at >= _since
    UNION ALL SELECT 'purchase','member_subscriptions', user_id, NULL, started_at FROM member_subscriptions WHERE started_at >= _since
  ), ea AS (
    SELECT ev.stage, ev.source, ev.at,
      CASE WHEN ev.user_id IS NOT NULL THEN 'u:'||ev.user_id WHEN i.user_id IS NOT NULL THEN 'u:'||i.user_id WHEN ev.visitor_id IS NOT NULL THEN 'v:'||ev.visitor_id END actor
    FROM ev LEFT JOIN idx i ON i.visitor_id = ev.visitor_id AND ev.user_id IS NULL
  ),
  s1 AS (SELECT DISTINCT actor FROM ea WHERE stage='view_pricing' AND actor IS NOT NULL),
  s2 AS (SELECT DISTINCT actor FROM ea WHERE stage='upgrade_click' AND actor IN (SELECT actor FROM s1)),
  s3 AS (SELECT DISTINCT actor FROM ea WHERE stage='begin_checkout' AND actor IN (SELECT actor FROM s2)),
  s4 AS (SELECT DISTINCT actor FROM ea WHERE stage='purchase' AND actor IN (SELECT actor FROM s3)),
  cur AS (SELECT 'view_pricing' k, 1 ord, (SELECT count(*) FROM s1) n, NULL::bigint prev
    UNION ALL SELECT 'upgrade_click',2,(SELECT count(*) FROM s2),(SELECT count(*) FROM s1)
    UNION ALL SELECT 'begin_checkout',3,(SELECT count(*) FROM s3),(SELECT count(*) FROM s2)
    UNION ALL SELECT 'purchase',4,(SELECT count(*) FROM s4),(SELECT count(*) FROM s3)),
  stat AS (SELECT stage, count(DISTINCT actor) all_actors, count(DISTINCT actor||'|'||floor(extract(epoch FROM at))) evs FROM ea WHERE actor IS NOT NULL GROUP BY 1),
  src AS (SELECT stage, jsonb_object_agg(source, n) bs FROM (SELECT stage, source, count(*) n FROM ea GROUP BY 1,2) z GROUP BY 1)
  SELECT jsonb_build_object(
    'steps', (SELECT jsonb_agg(jsonb_build_object('key',cur.k,'actors',cur.n,'events',coalesce(stat.evs,0),'prevActors',cur.prev,
        'rate', CASE WHEN cur.prev > 0 THEN cur.n::numeric/cur.prev END,
        'unattributed', coalesce(stat.all_actors,0)-cur.n, 'bySource', coalesce(src.bs,'{}'::jsonb)) ORDER BY cur.ord)
      FROM cur LEFT JOIN stat ON stat.stage=cur.k LEFT JOIN src ON src.stage=cur.k),
    'purchase_fact_actors', (SELECT count(DISTINCT user_id) FROM ev WHERE stage='purchase' AND user_id IS NOT NULL),
    'frontend_success_count', (SELECT count(*) FROM te WHERE event_name='checkout_success')
  ) INTO result;
  RETURN result;
END; $f$;
REVOKE ALL ON FUNCTION public.get_sequential_funnel(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sequential_funnel(timestamptz) TO authenticated;

-- 流量健康：全表 count(*) 三次超過逾時，改用統計估計與索引 max()
CREATE OR REPLACE FUNCTION public.get_traffic_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ev_est bigint; null_frac real;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT greatest(reltuples,0)::bigint INTO ev_est FROM pg_class WHERE oid='public.traffic_events'::regclass;
  SELECT s.null_frac INTO null_frac FROM pg_stats s WHERE s.schemaname='public' AND s.tablename='traffic_events' AND s.attname='event_name';
  RETURN jsonb_build_object(
    'visits_total', (SELECT greatest(reltuples,0)::bigint FROM pg_class WHERE oid='public.traffic_visits'::regclass),
    'events_total', ev_est,
    'named_events_total', round(ev_est * (1 - coalesce(null_frac,0)))::bigint,
    'is_estimate', true,
    'last_visit_at', (SELECT max(last_seen_at) FROM public.traffic_visits),
    'last_event_at', (SELECT max(occurred_at) FROM public.traffic_events)
  );
END;
$function$;