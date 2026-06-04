
-- 1) Admin one-click reset: clears non-brain-update usage rows for the given line_user_id.
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
       AND kind <> 'brain-update'
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
GRANT  EXECUTE ON FUNCTION public.admin_reset_line_free_quota(text) TO authenticated, service_role;


-- 2) Login-time reconciliation: refunds a Line free-tier usage row when no
--    actual analysis output is present in checkup_storage (i.e. user got
--    charged but never received a result). Idempotent; safe to call every login.
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
  v_has_brain boolean := false;
  v_refunded int := 0;
  v_reason text := 'skipped';
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
  v_is_line := v_email IS NOT NULL AND v_email LIKE 'line_%@line.local';

  IF NOT v_is_line THEN
    RETURN jsonb_build_object(
      'reconciled', false,
      'reason', 'not_line_user',
      'refunded_count', 0
    );
  END IF;

  SELECT count(*)::int INTO v_usage_count
    FROM public.checkup_usage
    WHERE user_id = _user_id AND kind <> 'brain-update';

  IF v_usage_count = 0 THEN
    RETURN jsonb_build_object(
      'reconciled', false,
      'reason', 'no_usage',
      'refunded_count', 0
    );
  END IF;

  -- Storage signals that the user actually received an analysis result.
  -- Either a non-empty analysis history, or a populated brain row counts.
  SELECT EXISTS (
    SELECT 1 FROM public.checkup_storage
     WHERE user_id = _user_id
       AND key = 'pf-analysis-history-v1'
       AND jsonb_typeof(data) = 'array'
       AND jsonb_array_length(data) > 0
  ) INTO v_has_history;

  SELECT EXISTS (
    SELECT 1 FROM public.checkup_storage
     WHERE user_id = _user_id
       AND key = 'pf-brain-v1'
       AND data <> '{}'::jsonb
       AND data IS NOT NULL
  ) INTO v_has_brain;

  IF v_has_history OR v_has_brain THEN
    v_reason := 'usage_matches_storage';
  ELSE
    -- Refund: usage exists but no analysis output was ever stored.
    WITH del AS (
      DELETE FROM public.checkup_usage
       WHERE user_id = _user_id
         AND kind <> 'brain-update'
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
      jsonb_build_object(
        'refunded_count', v_refunded,
        'at', now()
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'reconciled', v_refunded > 0,
    'reason', v_reason,
    'refunded_count', v_refunded,
    'usage_before', v_usage_count,
    'has_history', v_has_history,
    'has_brain', v_has_brain
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_line_free_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reconcile_line_free_quota(uuid) TO service_role;
