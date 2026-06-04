
-- 1) 修正 reconcile 邏輯：只看 analysis-history 長度
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
    WHERE user_id = _user_id AND kind <> 'brain-update';

  IF v_usage_count = 0 THEN
    RETURN jsonb_build_object('reconciled', false, 'reason', 'no_usage', 'refunded_count', 0);
  END IF;

  -- 唯一可靠訊號：pf-analysis-history-v1 是非空陣列才算真的有結果
  -- pf-brain-v1 不可用（demo 種子會預先填）
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
GRANT  EXECUTE ON FUNCTION public.reconcile_line_free_quota(uuid) TO service_role;

-- 2) 立刻對所有 LINE 帳號跑一次對帳
DO $$
DECLARE
  r record;
  res jsonb;
BEGIN
  FOR r IN
    SELECT p.user_id
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.user_id
     WHERE p.line_user_id IS NOT NULL
       AND u.email LIKE 'line_%@line.local'
  LOOP
    SELECT public.reconcile_line_free_quota(r.user_id) INTO res;
    RAISE NOTICE 'reconcile % => %', r.user_id, res;
  END LOOP;
END $$;
