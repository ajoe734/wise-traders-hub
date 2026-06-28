
-- P3.1: alerts notify state
ALTER TABLE public.system_alerts ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE public.system_alerts ADD COLUMN IF NOT EXISTS notify_error text;

-- P3.2: expert revenue breakdown RPC
CREATE OR REPLACE FUNCTION public.get_expert_revenue_breakdown(_from timestamptz, _to timestamptz)
RETURNS TABLE(
  expert_id uuid,
  expert_name text,
  expert_slug text,
  orders bigint,
  gross numeric,
  net numeric,
  platform_amount numeric,
  expert_amount numeric,
  channel_reserve numeric,
  unique_buyers bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT rs.*, pt.user_id_from_sub AS user_id
    FROM public.revenue_splits rs
    LEFT JOIN LATERAL (
      SELECT ms.user_id AS user_id_from_sub
      FROM public.payment_transactions pt
      LEFT JOIN public.member_subscriptions ms ON ms.id = pt.subscription_id
      WHERE pt.id = rs.transaction_id
      LIMIT 1
    ) pt ON TRUE
    WHERE rs.created_at >= _from AND rs.created_at < _to
      AND rs.expert_id IS NOT NULL
  )
  SELECT
    b.expert_id,
    e.name,
    e.slug,
    COUNT(*)::bigint AS orders,
    COALESCE(SUM(b.gross),0)::numeric AS gross,
    COALESCE(SUM(b.net),0)::numeric AS net,
    COALESCE(SUM(b.platform_amount),0)::numeric AS platform_amount,
    COALESCE(SUM(b.expert_amount),0)::numeric AS expert_amount,
    COALESCE(SUM(b.channel_reserve),0)::numeric AS channel_reserve,
    COUNT(DISTINCT b.user_id)::bigint AS unique_buyers
  FROM base b
  LEFT JOIN public.experts e ON e.id = b.expert_id
  WHERE public.has_role(auth.uid(), 'company_admin'::app_role)
  GROUP BY b.expert_id, e.name, e.slug
  ORDER BY gross DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_expert_revenue_breakdown(timestamptz, timestamptz) TO authenticated;

-- P3.3: funnel drop helper for a user
CREATE OR REPLACE FUNCTION public.get_user_funnel_drop(_user_id uuid, _from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_steps text[] := ARRAY['page_view','expert_view','plan_view','checkout_view','checkout_submit','checkout_success'];
  v_reached jsonb := '[]'::jsonb;
  s text;
  hit boolean;
  last_reached text;
  dropped_at text;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOREACH s IN ARRAY v_steps LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.traffic_events
      WHERE user_id = _user_id
        AND event_name = s
        AND occurred_at >= _from AND occurred_at < _to
    ) INTO hit;
    v_reached := v_reached || jsonb_build_array(jsonb_build_object('step', s, 'reached', hit));
    IF hit THEN last_reached := s; ELSIF last_reached IS NOT NULL AND dropped_at IS NULL THEN dropped_at := s; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'steps', v_reached,
    'last_reached', last_reached,
    'dropped_at', dropped_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_funnel_drop(uuid, timestamptz, timestamptz) TO authenticated;
