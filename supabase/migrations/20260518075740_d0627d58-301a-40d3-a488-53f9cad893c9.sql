
CREATE INDEX IF NOT EXISTS idx_experts_status_created
  ON public.experts (status, created_at);

CREATE INDEX IF NOT EXISTS idx_expert_plans_expert_active
  ON public.expert_plans (expert_id, is_active);

-- ──────────────────────────────────────────────────────────────────
-- get_public_experts_list: 一次回傳 /experts /app/explore 所需資料
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_experts_list()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at), '[]'::jsonb)
  FROM (
    SELECT
      e.id, e.slug, e.name, e.role, e.avatar_url, e.bio, e.description,
      e.style_tags, e.markets, e.strategy_summary,
      e.backtest_1y_return, e.backtest_max_drawdown, e.backtest_annual_return,
      e.starting_capital, e.risk_preference, e.operation_cycle, e.strategy_name,
      e.status, e.created_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id,
          'plan_type', p.plan_type,
          'name', p.name,
          'description', p.description,
          'price_monthly', p.price_monthly,
          'price_yearly', p.price_yearly,
          'features', p.features,
          'is_active', p.is_active
        ) ORDER BY p.price_monthly)
        FROM public.expert_plans p
        WHERE p.expert_id = e.id
          AND p.is_active = true
          AND p.review_status = 'approved'
      ), '[]'::jsonb) AS expert_plans
    FROM public.experts e
    WHERE e.status = 'active'
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_experts_list() TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- get_pricing_bundle: /pricing 一次撈完
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pricing_bundle(_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_advisor int;
  v_min_mentor int;
  v_checkup_plans jsonb;
  v_quota jsonb := NULL;
BEGIN
  SELECT MIN(price_monthly) INTO v_min_advisor
  FROM public.expert_plans
  WHERE is_active = true
    AND plan_type::text LIKE 'analyst_%';

  SELECT MIN(price_monthly) INTO v_min_mentor
  FROM public.expert_plans
  WHERE is_active = true
    AND plan_type::text = 'mentor_weekly_journal';

  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.sort_order), '[]'::jsonb)
  INTO v_checkup_plans
  FROM (
    SELECT id, tier, name, description, price_monthly, price_yearly,
           monthly_quota, quota_period, features, sort_order
    FROM public.checkup_plans
    WHERE is_active = true
  ) c;

  IF _user_id IS NOT NULL THEN
    BEGIN
      v_quota := public.check_checkup_quota(_user_id);
    EXCEPTION WHEN OTHERS THEN
      v_quota := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'min_advisor_price', v_min_advisor,
    'min_mentor_price', v_min_mentor,
    'checkup_plans', v_checkup_plans,
    'checkup_quota', v_quota
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pricing_bundle(uuid) TO anon, authenticated;
