-- ===== traffic_visits =====
CREATE TABLE public.traffic_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL UNIQUE,
  user_id uuid,
  first_landing_path text,
  first_referrer text,
  first_referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  ref_code text,
  channel text NOT NULL DEFAULT 'direct',
  device_kind text,
  country text,
  page_views integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_traffic_visits_user ON public.traffic_visits(user_id);
CREATE INDEX idx_traffic_visits_first_seen ON public.traffic_visits(first_seen_at);
CREATE INDEX idx_traffic_visits_campaign ON public.traffic_visits(utm_campaign);
CREATE INDEX idx_traffic_visits_channel ON public.traffic_visits(channel);

GRANT SELECT, INSERT, UPDATE ON public.traffic_visits TO anon;
GRANT SELECT, INSERT, UPDATE ON public.traffic_visits TO authenticated;
GRANT ALL ON public.traffic_visits TO service_role;

ALTER TABLE public.traffic_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access traffic_visits" ON public.traffic_visits
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Anyone can insert traffic_visits" ON public.traffic_visits
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Anyone can update own visit by visitor_id" ON public.traffic_visits
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users view own traffic_visits" ON public.traffic_visits
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ===== traffic_events =====
CREATE TABLE public.traffic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  user_id uuid,
  route text NOT NULL,
  referrer_host text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_traffic_events_visitor ON public.traffic_events(visitor_id);
CREATE INDEX idx_traffic_events_occurred ON public.traffic_events(occurred_at);
CREATE INDEX idx_traffic_events_route ON public.traffic_events(route);

GRANT INSERT ON public.traffic_events TO anon;
GRANT SELECT, INSERT ON public.traffic_events TO authenticated;
GRANT ALL ON public.traffic_events TO service_role;

ALTER TABLE public.traffic_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access traffic_events" ON public.traffic_events
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Anyone can insert traffic_events" ON public.traffic_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Users view own traffic_events" ON public.traffic_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ===== conversions =====
CREATE TABLE public.conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  visitor_id text,
  order_kind text NOT NULL,           -- expert_sub / checkup_sub / one_off
  order_id uuid,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  ref_code text,
  channel text NOT NULL DEFAULT 'direct',
  gross_amount integer NOT NULL DEFAULT 0,
  platform_amount integer NOT NULL DEFAULT 0,
  expert_amount integer NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversions_user ON public.conversions(user_id);
CREATE INDEX idx_conversions_occurred ON public.conversions(occurred_at);
CREATE INDEX idx_conversions_campaign ON public.conversions(utm_campaign);
CREATE INDEX idx_conversions_channel ON public.conversions(channel);

GRANT SELECT ON public.conversions TO authenticated;
GRANT ALL ON public.conversions TO service_role;

ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access conversions" ON public.conversions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Users view own conversions" ON public.conversions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ===== ad_spend =====
CREATE TABLE public.ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utm_source text,
  utm_medium text,
  utm_campaign text NOT NULL,
  yyyymm text NOT NULL,               -- e.g. 2026-05
  spend_amount integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (utm_campaign, yyyymm)
);

GRANT ALL ON public.ad_spend TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_spend TO authenticated;

ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access ad_spend" ON public.ad_spend
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

CREATE TRIGGER ad_spend_touch
BEFORE UPDATE ON public.ad_spend
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== channel derivation =====
CREATE OR REPLACE FUNCTION public.derive_traffic_channel(
  _utm_medium text, _utm_source text, _referrer_host text
) RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  m text := lower(coalesce(_utm_medium, ''));
  s text := lower(coalesce(_utm_source, ''));
  h text := lower(coalesce(_referrer_host, ''));
BEGIN
  IF m IN ('cpc','paid','ppc','display','paid-social','paidsocial','paid_social') THEN
    RETURN 'paid';
  END IF;
  IF m = 'email' OR s IN ('email','newsletter','edm') THEN
    RETURN 'email';
  END IF;
  IF m IN ('social','social-organic') OR s IN ('facebook','fb','instagram','ig','line','threads','x','twitter','tiktok','youtube','yt') THEN
    RETURN 'social';
  END IF;
  IF m = 'organic' OR s IN ('google','bing','yahoo','duckduckgo','baidu') THEN
    RETURN 'organic';
  END IF;
  IF h <> '' THEN
    IF h LIKE '%google.%' OR h LIKE '%bing.%' OR h LIKE '%yahoo.%' OR h LIKE '%duckduckgo.%' OR h LIKE '%baidu.%' THEN
      RETURN 'organic';
    END IF;
    IF h LIKE '%facebook.%' OR h LIKE '%instagram.%' OR h LIKE '%line.%' OR h LIKE '%t.co' OR h LIKE '%twitter.%' OR h LIKE '%x.com' OR h LIKE '%threads.%' OR h LIKE '%tiktok.%' OR h LIKE '%youtube.%' OR h LIKE '%youtu.be' THEN
      RETURN 'social';
    END IF;
    RETURN 'referral';
  END IF;
  RETURN 'direct';
END;
$$;

-- ===== admin overview RPC =====
CREATE OR REPLACE FUNCTION public.get_traffic_overview(_from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kpi jsonb;
  v_daily jsonb;
  v_channels jsonb;
  v_campaigns jsonb;
  v_referrers jsonb;
  v_landings jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT jsonb_build_object(
    'visitors', (SELECT COUNT(*) FROM traffic_visits WHERE first_seen_at >= _from AND first_seen_at < _to),
    'returning_visitors', (SELECT COUNT(*) FROM traffic_visits WHERE last_seen_at >= _from AND last_seen_at < _to AND first_seen_at < _from),
    'page_views', (SELECT COUNT(*) FROM traffic_events WHERE occurred_at >= _from AND occurred_at < _to),
    'signups', (SELECT COUNT(*) FROM traffic_visits WHERE user_id IS NOT NULL AND first_seen_at >= _from AND first_seen_at < _to),
    'orders', (SELECT COUNT(*) FROM conversions WHERE occurred_at >= _from AND occurred_at < _to),
    'gross', COALESCE((SELECT SUM(gross_amount) FROM conversions WHERE occurred_at >= _from AND occurred_at < _to), 0),
    'platform', COALESCE((SELECT SUM(platform_amount) FROM conversions WHERE occurred_at >= _from AND occurred_at < _to), 0)
  ) INTO v_kpi;

  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      (date_trunc('day', g) AT TIME ZONE 'Asia/Taipei')::date AS day,
      (SELECT COUNT(*) FROM traffic_visits WHERE first_seen_at >= g AND first_seen_at < g + interval '1 day') AS visitors,
      (SELECT COUNT(*) FROM traffic_events WHERE occurred_at >= g AND occurred_at < g + interval '1 day') AS page_views,
      (SELECT COUNT(*) FROM conversions WHERE occurred_at >= g AND occurred_at < g + interval '1 day') AS orders,
      COALESCE((SELECT SUM(gross_amount) FROM conversions WHERE occurred_at >= g AND occurred_at < g + interval '1 day'), 0) AS gross
    FROM generate_series(date_trunc('day', _from), date_trunc('day', _to), interval '1 day') g
  ) d;

  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.visitors DESC), '[]'::jsonb)
  INTO v_channels
  FROM (
    SELECT
      channel,
      COUNT(*) AS visitors,
      (SELECT COUNT(*) FROM conversions co WHERE co.channel = tv.channel AND co.occurred_at >= _from AND co.occurred_at < _to) AS orders,
      (SELECT COALESCE(SUM(gross_amount),0) FROM conversions co WHERE co.channel = tv.channel AND co.occurred_at >= _from AND co.occurred_at < _to) AS gross
    FROM traffic_visits tv
    WHERE first_seen_at >= _from AND first_seen_at < _to
    GROUP BY channel
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.gross DESC NULLS LAST, c.visitors DESC), '[]'::jsonb)
  INTO v_campaigns
  FROM (
    SELECT
      COALESCE(NULLIF(tv.utm_campaign,''), '(none)') AS campaign,
      COALESCE(NULLIF(tv.utm_source,''), '(direct)') AS source,
      COALESCE(NULLIF(tv.utm_medium,''), '(none)') AS medium,
      COUNT(*) AS visitors,
      COUNT(*) FILTER (WHERE tv.user_id IS NOT NULL) AS signups,
      (SELECT COUNT(*) FROM conversions co WHERE COALESCE(NULLIF(co.utm_campaign,''),'(none)') = COALESCE(NULLIF(tv.utm_campaign,''),'(none)') AND co.occurred_at >= _from AND co.occurred_at < _to) AS orders,
      (SELECT COALESCE(SUM(gross_amount),0) FROM conversions co WHERE COALESCE(NULLIF(co.utm_campaign,''),'(none)') = COALESCE(NULLIF(tv.utm_campaign,''),'(none)') AND co.occurred_at >= _from AND co.occurred_at < _to) AS gross
    FROM traffic_visits tv
    WHERE first_seen_at >= _from AND first_seen_at < _to
    GROUP BY 1, 2, 3
    LIMIT 100
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.visitors DESC), '[]'::jsonb)
  INTO v_referrers
  FROM (
    SELECT COALESCE(NULLIF(first_referrer_host,''), '(direct)') AS host, COUNT(*) AS visitors
    FROM traffic_visits
    WHERE first_seen_at >= _from AND first_seen_at < _to
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 20
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(l) ORDER BY l.visitors DESC), '[]'::jsonb)
  INTO v_landings
  FROM (
    SELECT COALESCE(NULLIF(first_landing_path,''), '/') AS path, COUNT(*) AS visitors
    FROM traffic_visits
    WHERE first_seen_at >= _from AND first_seen_at < _to
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 20
  ) l;

  RETURN jsonb_build_object(
    'kpi', v_kpi,
    'daily', v_daily,
    'channels', v_channels,
    'campaigns', v_campaigns,
    'referrers', v_referrers,
    'landings', v_landings
  );
END;
$$;

-- ===== cleanup function =====
CREATE OR REPLACE FUNCTION public.cleanup_old_traffic()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.traffic_events WHERE occurred_at < now() - interval '90 days';
  DELETE FROM public.traffic_visits WHERE last_seen_at < now() - interval '365 days' AND user_id IS NULL;
$$;