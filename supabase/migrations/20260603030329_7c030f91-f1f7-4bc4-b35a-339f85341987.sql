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
  v_limit int := 0;
  v_used int := 0;
  v_period_start timestamptz;
  v_resets_at timestamptz;
  v_last_used_at timestamptz;
  v_is_tester boolean := false;
  v_now_tw timestamp;
  v_email text;
  v_is_line boolean := false;
BEGIN
  SELECT COALESCE(p.is_tester, false) INTO v_is_tester
    FROM public.profiles p WHERE p.user_id = _user_id LIMIT 1;

  IF v_is_tester THEN
    v_tier := 'pro';
    v_period := 'month';
    v_limit := 22;
  ELSE
    SELECT cp.tier, cp.quota_period, cp.monthly_quota
      INTO v_tier, v_period, v_limit
    FROM public.checkup_subscriptions cs
    JOIN public.checkup_plans cp ON cp.id = cs.plan_id
    WHERE cs.user_id = _user_id
      AND cs.status = 'active'
      AND (cs.expires_at IS NULL OR cs.expires_at > now())
    ORDER BY cp.sort_order DESC
    LIMIT 1;

    IF v_tier IS NULL THEN
      SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
      v_is_line := v_email IS NOT NULL AND v_email LIKE 'line_%@line.local';

      IF v_is_line THEN
        v_tier := 'line_free';
        v_period := 'lifetime';
        v_limit := 1;
      ELSE
        v_tier := 'none';
        v_period := 'month';
        v_limit := 0;
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

  IF v_limit > 0 THEN
    SELECT COUNT(*)::int, MAX(used_at)
      INTO v_used, v_last_used_at
      FROM public.checkup_usage
     WHERE user_id = _user_id
       AND used_at >= v_period_start;
  ELSE
    v_used := 0;
    v_last_used_at := NULL;
  END IF;

  RETURN jsonb_build_object(
    'tier', v_tier,
    'period', v_period,
    'limit', v_limit,
    'used', v_used,
    'remaining', GREATEST(v_limit - v_used, 0),
    'resets_at', v_resets_at,
    'last_used_at', v_last_used_at
  );
END;
$$;