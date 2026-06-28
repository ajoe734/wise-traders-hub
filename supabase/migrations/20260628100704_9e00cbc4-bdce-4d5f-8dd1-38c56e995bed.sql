
CREATE TABLE IF NOT EXISTS public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  level text NOT NULL DEFAULT 'warning',
  title text NOT NULL,
  message text,
  metric_value numeric,
  threshold numeric,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  fired_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_fired ON public.system_alerts(fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_alerts_kind ON public.system_alerts(kind);
CREATE INDEX IF NOT EXISTS idx_system_alerts_open ON public.system_alerts(resolved_at) WHERE resolved_at IS NULL;

GRANT SELECT, UPDATE ON public.system_alerts TO authenticated;
GRANT ALL ON public.system_alerts TO service_role;
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view system alerts" ON public.system_alerts;
CREATE POLICY "Admins view system alerts" ON public.system_alerts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'::app_role));

DROP POLICY IF EXISTS "Admins update system alerts" ON public.system_alerts;
CREATE POLICY "Admins update system alerts" ON public.system_alerts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'::app_role));

CREATE OR REPLACE FUNCTION public.get_roas_ltv_by_campaign(
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE(
  utm_campaign text,
  utm_source text,
  utm_medium text,
  spend numeric,
  conversions_count bigint,
  unique_buyers bigint,
  gross_revenue numeric,
  first_arpu numeric,
  cac numeric,
  roas numeric,
  ltv_30d numeric,
  ltv_90d numeric,
  payback_ratio numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH conv AS (
    SELECT
      COALESCE(NULLIF(c.utm_campaign,''),'(none)') AS utm_campaign,
      COALESCE(NULLIF(c.utm_source,''),'(direct)') AS utm_source,
      COALESCE(NULLIF(c.utm_medium,''),'(none)') AS utm_medium,
      c.user_id,
      c.gross_amount::numeric AS gross_amount,
      c.occurred_at
    FROM public.conversions c
    WHERE c.occurred_at >= _from AND c.occurred_at < _to
  ),
  agg_conv AS (
    SELECT utm_campaign, utm_source, utm_medium,
           COUNT(*)::bigint AS conversions_count,
           COUNT(DISTINCT user_id)::bigint AS unique_buyers,
           COALESCE(SUM(gross_amount),0) AS gross_revenue
    FROM conv
    GROUP BY 1,2,3
  ),
  ltv AS (
    SELECT
      c.utm_campaign,
      SUM(CASE WHEN pt.created_at <= c.occurred_at + interval '30 days' THEN pt.amount ELSE 0 END)::numeric AS ltv_30d,
      SUM(CASE WHEN pt.created_at <= c.occurred_at + interval '90 days' THEN pt.amount ELSE 0 END)::numeric AS ltv_90d
    FROM conv c
    JOIN public.member_subscriptions ms ON ms.user_id = c.user_id
    JOIN public.payment_transactions pt ON pt.subscription_id = ms.id
    WHERE pt.created_at >= c.occurred_at
      AND pt.status::text IN ('succeeded','paid','success')
    GROUP BY 1
  ),
  spend AS (
    SELECT COALESCE(NULLIF(s.utm_campaign,''),'(none)') AS utm_campaign,
           SUM(s.spend_amount)::numeric AS spend
    FROM public.ad_spend s
    WHERE to_date(s.yyyymm,'YYYYMM') >= date_trunc('month', _from)
      AND to_date(s.yyyymm,'YYYYMM') <  date_trunc('month', _to) + interval '1 month'
    GROUP BY 1
  )
  SELECT
    a.utm_campaign,
    a.utm_source,
    a.utm_medium,
    COALESCE(sp.spend, 0) AS spend,
    a.conversions_count,
    a.unique_buyers,
    a.gross_revenue,
    CASE WHEN a.conversions_count > 0 THEN a.gross_revenue / a.conversions_count ELSE 0 END AS first_arpu,
    CASE WHEN a.unique_buyers > 0 AND COALESCE(sp.spend,0) > 0 THEN sp.spend / a.unique_buyers ELSE 0 END AS cac,
    CASE WHEN COALESCE(sp.spend,0) > 0 THEN a.gross_revenue / sp.spend ELSE 0 END AS roas,
    COALESCE(l.ltv_30d, 0) AS ltv_30d,
    COALESCE(l.ltv_90d, 0) AS ltv_90d,
    CASE WHEN COALESCE(sp.spend,0) > 0 THEN COALESCE(l.ltv_90d,0) / sp.spend ELSE 0 END AS payback_ratio
  FROM agg_conv a
  LEFT JOIN spend sp USING (utm_campaign)
  LEFT JOIN ltv l USING (utm_campaign)
  WHERE public.has_role(auth.uid(), 'company_admin'::app_role)
  ORDER BY a.gross_revenue DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_roas_ltv_by_campaign(timestamptz, timestamptz) TO authenticated;
