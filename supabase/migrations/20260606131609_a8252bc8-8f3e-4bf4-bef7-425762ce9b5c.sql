
-- 1) 補償權益表
CREATE TABLE IF NOT EXISTS public.checkup_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount int NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  source text,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkup_entitlements_user_active
  ON public.checkup_entitlements(user_id, is_active);

GRANT SELECT ON public.checkup_entitlements TO authenticated;
GRANT ALL    ON public.checkup_entitlements TO service_role;

ALTER TABLE public.checkup_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own entitlements"
  ON public.checkup_entitlements FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admins full access entitlements"
  ON public.checkup_entitlements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_checkup_entitlements_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_checkup_entitlements ON public.checkup_entitlements;
CREATE TRIGGER trg_touch_checkup_entitlements
  BEFORE UPDATE ON public.checkup_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.touch_checkup_entitlements_updated_at();

-- 2) 改寫 check_checkup_quota：原 tier 之上加總補償權益
CREATE OR REPLACE FUNCTION public.check_checkup_quota(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text := 'none';
  v_period text := 'month';
  v_base_limit int := 0;
  v_used int := 0;
  v_period_start timestamptz;
  v_resets_at timestamptz;
  v_last_used_at timestamptz := NULL;
  v_is_tester boolean := false;
  v_now_tw timestamp;
  v_email text;
  v_is_line boolean := false;
  v_entitlement_total int := 0;
  v_entitlement_used int := 0;
  v_entitlement_remaining int := 0;
  v_total_limit int := 0;
  v_total_remaining int := 0;
BEGIN
  SELECT COALESCE(p.is_tester, false) INTO v_is_tester
    FROM public.profiles p WHERE p.user_id = _user_id LIMIT 1;

  IF v_is_tester THEN
    v_tier := 'pro'; v_period := 'month'; v_base_limit := 22;
  ELSE
    SELECT cp.tier, cp.quota_period, cp.monthly_quota
      INTO v_tier, v_period, v_base_limit
      FROM public.checkup_subscriptions cs
      JOIN public.checkup_plans cp ON cp.id = cs.plan_id
     WHERE cs.user_id = _user_id
       AND cs.status = 'active'
       AND (cs.expires_at IS NULL OR cs.expires_at > now())
     ORDER BY cp.sort_order DESC LIMIT 1;

    IF v_tier IS NULL THEN
      SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
      v_is_line := v_email IS NOT NULL AND v_email LIKE 'line_%@line.local';
      IF v_is_line THEN
        v_tier := 'line_free'; v_period := 'lifetime'; v_base_limit := 1;
      ELSE
        v_tier := 'none'; v_period := 'month'; v_base_limit := 0;
      END IF;
    END IF;
  END IF;

  v_now_tw := (now() AT TIME ZONE 'Asia/Taipei');
  IF v_period = 'lifetime' THEN
    v_period_start := 'epoch'::timestamptz;
    v_resets_at := 'infinity'::timestamptz;
  ELSIF v_period = 'week' THEN
    v_period_start := (date_trunc('week', v_now_tw) AT TIME ZONE 'Asia/Taipei');
    v_resets_at := v_period_start + INTERVAL '7 days';
  ELSE
    v_period_start := (date_trunc('month', v_now_tw) AT TIME ZONE 'Asia/Taipei');
    v_resets_at := ((date_trunc('month', v_now_tw) + INTERVAL '1 month') AT TIME ZONE 'Asia/Taipei');
  END IF;

  -- 已使用次數（不含 brain-update）
  BEGIN
    SELECT COALESCE(COUNT(*) FILTER (WHERE used_at >= v_period_start), 0)::int,
           MAX(used_at) FILTER (WHERE used_at >= v_period_start)
      INTO v_used, v_last_used_at
      FROM public.checkup_usage
     WHERE user_id = _user_id AND kind <> 'brain-update';
  EXCEPTION WHEN OTHERS THEN
    v_used := 0; v_last_used_at := NULL;
  END;

  -- 補償權益：加總所有 active 且未過期的 amount
  SELECT COALESCE(SUM(amount), 0)::int INTO v_entitlement_total
    FROM public.checkup_entitlements
   WHERE user_id = _user_id
     AND is_active = true
     AND (expires_at IS NULL OR expires_at > now());

  -- 補償視為「優先於 base 之上」的額外額度
  -- 計算：v_used 同時消耗 base + entitlement，先扣 base 再扣 entitlement
  v_total_limit := v_base_limit + v_entitlement_total;
  v_total_remaining := GREATEST(v_total_limit - v_used, 0);

  RETURN jsonb_build_object(
    'tier', v_tier,
    'period', v_period,
    'limit', v_total_limit,
    'base_limit', v_base_limit,
    'entitlement_total', v_entitlement_total,
    'used', COALESCE(v_used, 0),
    'remaining', v_total_remaining,
    'resets_at', v_resets_at,
    'last_used_at', v_last_used_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_checkup_quota(uuid) TO authenticated, service_role;

-- 3) 一次性回送：所有 LINE 註冊會員 +1 補償額度
INSERT INTO public.checkup_entitlements (user_id, amount, reason, source)
SELECT p.user_id, 1, 'legacy_apology_2026_06', 'auto_seed_line_users'
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
 WHERE u.email LIKE 'line_%@line.local'
   AND NOT EXISTS (
     SELECT 1 FROM public.checkup_entitlements e
      WHERE e.user_id = p.user_id
        AND e.reason = 'legacy_apology_2026_06'
   );
