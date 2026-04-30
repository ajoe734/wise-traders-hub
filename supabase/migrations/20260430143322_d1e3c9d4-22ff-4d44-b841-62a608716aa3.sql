-- 1. Add quota_period column
ALTER TABLE public.checkup_plans
  ADD COLUMN IF NOT EXISTS quota_period text NOT NULL DEFAULT 'month';

ALTER TABLE public.checkup_plans
  DROP CONSTRAINT IF EXISTS checkup_plans_quota_period_check;
ALTER TABLE public.checkup_plans
  ADD CONSTRAINT checkup_plans_quota_period_check CHECK (quota_period IN ('week','month'));

-- 2. Update existing plans
UPDATE public.checkup_plans SET quota_period = 'week',  monthly_quota = 1  WHERE tier = 'basic';
UPDATE public.checkup_plans SET quota_period = 'month', monthly_quota = 22 WHERE tier = 'pro';

-- 3. Index for usage lookup
CREATE INDEX IF NOT EXISTS idx_checkup_usage_user_used_at
  ON public.checkup_usage (user_id, used_at DESC);

-- 4. check_checkup_quota
CREATE OR REPLACE FUNCTION public.check_checkup_quota(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text := 'free';
  v_period text := 'month';
  v_limit int := 1;
  v_used int := 0;
  v_period_start timestamptz;
  v_resets_at timestamptz;
  v_is_tester boolean := false;
  v_now_tw timestamp;
BEGIN
  -- Tester => treat as pro
  SELECT COALESCE(p.is_tester, false) INTO v_is_tester
    FROM public.profiles p WHERE p.user_id = _user_id LIMIT 1;

  IF v_is_tester THEN
    v_tier := 'pro';
    v_period := 'month';
    v_limit := 22;
  ELSE
    -- Active subscription?
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
      v_tier := 'free';
      v_period := 'month';
      v_limit := 1;
    END IF;
  END IF;

  -- Compute period_start in Asia/Taipei timezone
  v_now_tw := (now() AT TIME ZONE 'Asia/Taipei');
  IF v_period = 'week' THEN
    -- ISO week: Monday 00:00 Taipei
    v_period_start := (date_trunc('week', v_now_tw) AT TIME ZONE 'Asia/Taipei');
    v_resets_at := v_period_start + INTERVAL '7 days';
  ELSE
    v_period_start := (date_trunc('month', v_now_tw) AT TIME ZONE 'Asia/Taipei');
    v_resets_at := ((date_trunc('month', v_now_tw) + INTERVAL '1 month') AT TIME ZONE 'Asia/Taipei');
  END IF;

  SELECT COUNT(*)::int INTO v_used
    FROM public.checkup_usage
   WHERE user_id = _user_id
     AND used_at >= v_period_start;

  RETURN jsonb_build_object(
    'tier', v_tier,
    'period', v_period,
    'limit', v_limit,
    'used', v_used,
    'remaining', GREATEST(v_limit - v_used, 0),
    'resets_at', v_resets_at
  );
END;
$$;

-- 5. consume_checkup_quota (atomic)
CREATE OR REPLACE FUNCTION public.consume_checkup_quota(_user_id uuid, _kind text DEFAULT 'analysis')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q jsonb;
  v_remaining int;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Lock row by inserting a no-op marker; we rely on advisory lock for concurrency
  PERFORM pg_advisory_xact_lock(hashtext('checkup_quota:' || _user_id::text));

  v_q := public.check_checkup_quota(_user_id);
  v_remaining := (v_q->>'remaining')::int;

  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED' USING DETAIL = v_q::text;
  END IF;

  INSERT INTO public.checkup_usage (user_id, kind) VALUES (_user_id, COALESCE(_kind, 'analysis'));

  RETURN jsonb_set(v_q, '{used}', to_jsonb(((v_q->>'used')::int + 1)))
       || jsonb_build_object('remaining', v_remaining - 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_checkup_quota(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_checkup_quota(uuid, text) TO authenticated;