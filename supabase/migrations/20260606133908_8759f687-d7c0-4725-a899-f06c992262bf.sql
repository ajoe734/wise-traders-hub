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

  BEGIN
    SELECT COALESCE(COUNT(*) FILTER (WHERE used_at >= v_period_start), 0)::int,
           MAX(used_at) FILTER (WHERE used_at >= v_period_start)
      INTO v_used, v_last_used_at
      FROM public.checkup_usage
     WHERE user_id = _user_id
       AND kind = 'daily-analysis';
  EXCEPTION WHEN OTHERS THEN
    v_used := 0; v_last_used_at := NULL;
  END;

  SELECT COALESCE(SUM(amount), 0)::int INTO v_entitlement_total
    FROM public.checkup_entitlements
   WHERE user_id = _user_id
     AND is_active = true
     AND (expires_at IS NULL OR expires_at > now());

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

CREATE OR REPLACE FUNCTION public.reconcile_line_free_quota(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_is_line boolean := false;
  v_usage_count int := 0;
  v_has_history boolean := false;
  v_refunded int := 0;
  v_reason text := 'skipped';
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
  v_is_line := v_email IS NOT NULL AND v_email LIKE 'line_%@line.local';

  IF NOT v_is_line THEN
    RETURN jsonb_build_object('reconciled', false, 'reason', 'not_line_user', 'refunded_count', 0);
  END IF;

  SELECT count(*)::int INTO v_usage_count
    FROM public.checkup_usage
   WHERE user_id = _user_id
     AND kind = 'daily-analysis';

  IF v_usage_count = 0 THEN
    RETURN jsonb_build_object('reconciled', false, 'reason', 'no_usage', 'refunded_count', 0);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.checkup_storage
     WHERE user_id = _user_id
       AND key = 'pf-analysis-history-v1'
       AND jsonb_typeof(data) = 'array'
       AND jsonb_array_length(data) > 0
  ) INTO v_has_history;

  IF v_has_history THEN
    v_reason := 'usage_matches_storage';
  ELSE
    WITH del AS (
      DELETE FROM public.checkup_usage
       WHERE user_id = _user_id
         AND kind = 'daily-analysis'
       RETURNING 1
    )
    SELECT count(*)::int INTO v_refunded FROM del;
    v_reason := 'refunded_no_storage';

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
    VALUES (
      NULL,
      'checkup_quota.reconcile_refund',
      'profile',
      _user_id,
      jsonb_build_object('refunded_count', v_refunded, 'at', now())
    );
  END IF;

  RETURN jsonb_build_object(
    'reconciled', v_refunded > 0,
    'reason', v_reason,
    'refunded_count', v_refunded,
    'usage_before', v_usage_count,
    'has_history', v_has_history
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_line_free_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_line_free_quota(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_reset_line_free_quota(_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_user_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_deleted int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.has_role(v_caller, 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _line_user_id IS NULL OR length(trim(_line_user_id)) = 0 THEN
    RAISE EXCEPTION 'MISSING_LINE_USER_ID';
  END IF;

  SELECT user_id INTO v_user_id
    FROM public.profiles
   WHERE line_user_id = _line_user_id
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'LINE_USER_NOT_FOUND';
  END IF;

  v_before := public.check_checkup_quota(v_user_id);

  WITH del AS (
    DELETE FROM public.checkup_usage
     WHERE user_id = v_user_id
       AND kind = 'daily-analysis'
     RETURNING 1
  )
  SELECT count(*)::int INTO v_deleted FROM del;

  v_after := public.check_checkup_quota(v_user_id);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
  VALUES (
    v_caller,
    'checkup_quota.admin_reset_line_free',
    'profile',
    v_user_id,
    jsonb_build_object(
      'line_user_id', _line_user_id,
      'deleted_count', v_deleted,
      'before', v_before,
      'after', v_after,
      'at', now()
    )
  );

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'line_user_id', _line_user_id,
    'deleted_count', v_deleted,
    'before', v_before,
    'after', v_after
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reset_line_free_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_line_free_quota(text) TO authenticated, service_role;

DELETE FROM public.checkup_usage
WHERE kind = 'parse';