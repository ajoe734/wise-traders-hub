-- Extracted read-only from production (pg_get_functiondef) for clone-side execution.
-- Intended caller/owner: postgres (SECURITY DEFINER). Never granted to anon/authenticated.
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.run_rls_subscription_tests()
 RETURNS TABLE(test_name text, passed boolean, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := '2026-07-14 12:00:00+08'::timestamptz;
  v_user uuid := '00000000-0000-0000-0000-0000000000aa'::uuid;
  v_user_gap uuid := '00000000-0000-0000-0000-0000000000bb'::uuid;
  v_user_expired uuid := '00000000-0000-0000-0000-0000000000cc'::uuid;
  v_expert_mentor uuid;
  v_expert_advisor uuid;
  v_plan_m uuid;
  v_plan_a uuid;
  v_seen boolean;
BEGIN
  -- === Part A：純視窗函數單元測試 ===
  test_name := 'mentor: signal within window'; detail := '';
  passed := public.signal_in_subscription_window('mentor'::expert_role,
    '2026-06-01'::timestamptz, '2026-07-01'::timestamptz, '2026-06-15'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: 7-day lookback within 7d before start → visible';
  passed := public.signal_in_subscription_window('mentor'::expert_role,
    '2026-06-08'::timestamptz, '2026-07-08'::timestamptz, '2026-06-02'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: 7-day lookback boundary (exactly 7d) → visible';
  passed := public.signal_in_subscription_window('mentor'::expert_role,
    '2026-06-08 12:00+08'::timestamptz, '2026-07-08'::timestamptz, '2026-06-01 12:00+08'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: 8d before start → NOT visible';
  passed := NOT public.signal_in_subscription_window('mentor'::expert_role,
    '2026-06-08 12:00+08'::timestamptz, '2026-07-08'::timestamptz, '2026-05-31 11:00+08'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: signal after expires_at → NOT visible';
  passed := NOT public.signal_in_subscription_window('mentor'::expert_role,
    '2026-06-01'::timestamptz, '2026-07-01'::timestamptz, '2026-07-05'::timestamptz);
  RETURN NEXT;

  test_name := 'advisor: 7-day lookback does NOT apply (1d before start → NOT visible)';
  passed := NOT public.signal_in_subscription_window('advisor'::expert_role,
    '2026-06-08'::timestamptz, '2026-07-08'::timestamptz, '2026-06-07'::timestamptz);
  RETURN NEXT;

  test_name := 'advisor: signal exactly at started_at → visible';
  passed := public.signal_in_subscription_window('advisor'::expert_role,
    '2026-06-08 12:00+08'::timestamptz, '2026-07-08'::timestamptz, '2026-06-08 12:00+08'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: no expires_at (unlimited) → future signal visible';
  passed := public.signal_in_subscription_window('mentor'::expert_role,
    '2026-06-01'::timestamptz, NULL, '2030-01-01'::timestamptz);
  RETURN NEXT;

  -- === Part B：端到端 has_active_subscription_after 測試（seed 後 rollback）===
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    VALUES
      (v_user,         '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-a@test.local', '', v_now, v_now),
      (v_user_gap,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-b@test.local', '', v_now, v_now),
      (v_user_expired, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-c@test.local', '', v_now, v_now)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.experts (user_id, slug, name, role)
    VALUES (v_user, 'rls-test-mentor-'  || substr(md5(random()::text),1,8), 'RLS Test Mentor',  'mentor')
    RETURNING id INTO v_expert_mentor;

    INSERT INTO public.experts (user_id, slug, name, role)
    VALUES (v_user, 'rls-test-advisor-' || substr(md5(random()::text),1,8), 'RLS Test Advisor', 'advisor')
    RETURNING id INTO v_expert_advisor;

    INSERT INTO public.expert_plans (expert_id, name, plan_type, price_monthly, is_active, review_status)
    VALUES (v_expert_mentor,  'M', 'mentor_weekly_journal'::plan_type, 100, true, 'approved'::plan_review_status)
    RETURNING id INTO v_plan_m;

    INSERT INTO public.expert_plans (expert_id, name, plan_type, price_monthly, is_active, review_status)
    VALUES (v_expert_advisor, 'A', 'analyst_signal_l1'::plan_type, 100, true, 'approved'::plan_review_status)
    RETURNING id INTO v_plan_a;

    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES
      (v_user, v_plan_m, 'expired', '2026-05-10'::timestamptz, '2026-06-10'::timestamptz),
      (v_user, v_plan_m, 'active',  '2026-07-14'::timestamptz, '2026-08-14'::timestamptz);

    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES (v_user_gap, v_plan_m, 'active', '2026-07-14'::timestamptz, '2026-08-14'::timestamptz);

    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES (v_user_expired, v_plan_m, 'expired', '2026-05-10'::timestamptz, '2026-06-10'::timestamptz);

    SELECT EXISTS(SELECT 1 FROM public.has_active_subscription_after(v_user, '2026-05-20'::timestamptz)
      WHERE expert_id = v_expert_mentor) INTO v_seen;
    test_name := 'renew after expire: old-window signal is unlocked';
    passed := v_seen; detail := CASE WHEN v_seen THEN '' ELSE 'expected visible after renewal' END;
    RETURN NEXT;

    SELECT EXISTS(SELECT 1 FROM public.has_active_subscription_after(v_user, '2026-06-20'::timestamptz)
      WHERE expert_id = v_expert_mentor) INTO v_seen;
    test_name := 'gap window: signal published in gap → NOT visible';
    passed := NOT v_seen; detail := CASE WHEN v_seen THEN 'gap signal must NOT be visible' ELSE '' END;
    RETURN NEXT;

    SELECT EXISTS(SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-05-20'::timestamptz)
      WHERE expert_id = v_expert_mentor) INTO v_seen;
    test_name := 'no prior subscription: pre-active signal → NOT visible';
    passed := NOT v_seen; detail := CASE WHEN v_seen THEN 'must not see history user never paid for' ELSE '' END;
    RETURN NEXT;

    SELECT EXISTS(SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-07-08'::timestamptz)
      WHERE expert_id = v_expert_mentor) INTO v_seen;
    test_name := 'mentor 7d lookback: 6 days before start → visible';
    passed := v_seen; detail := CASE WHEN v_seen THEN '' ELSE '7d lookback broken' END;
    RETURN NEXT;

    SELECT EXISTS(SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-07-06 11:00+08'::timestamptz)
      WHERE expert_id = v_expert_mentor) INTO v_seen;
    test_name := 'mentor 7d lookback: 8 days before start → NOT visible';
    passed := NOT v_seen; detail := CASE WHEN v_seen THEN '7d boundary leaks' ELSE '' END;
    RETURN NEXT;

    SELECT EXISTS(SELECT 1 FROM public.has_active_subscription_after(v_user_expired, '2026-05-20'::timestamptz)
      WHERE expert_id = v_expert_mentor) INTO v_seen;
    test_name := 'expired only (no active): historical signal → NOT visible';
    passed := NOT v_seen; detail := CASE WHEN v_seen THEN 'expired user must not read history' ELSE '' END;
    RETURN NEXT;

    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES (v_user_gap, v_plan_a, 'active', '2026-07-14'::timestamptz, '2026-08-14'::timestamptz);

    SELECT EXISTS(SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-07-10'::timestamptz)
      WHERE expert_id = v_expert_advisor) INTO v_seen;
    test_name := 'advisor: no 7d lookback (4 days before start) → NOT visible';
    passed := NOT v_seen; detail := CASE WHEN v_seen THEN 'advisor should not have 7d lookback' ELSE '' END;
    RETURN NEXT;

    RAISE EXCEPTION 'ROLLBACK_TESTS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TESTS' THEN
      test_name := 'seed/execution error'; passed := false; detail := SQLERRM;
      RETURN NEXT;
    END IF;
  END;

  RETURN;
END;
$function$


;
-- ---------------------------------------------------------------------
-- T-P99c closure. Root cause: CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default, so `anon` inherited EXECUTE on a SECURITY DEFINER harness owned
-- by postgres. Exact failing probe on the clone before this fix:
--   SELECT has_function_privilege('anon','public.run_rls_subscription_tests()','EXECUTE');
--   expected f / actual t (no SQLSTATE: it is a silent privilege leak, which
--   is why T-P99c asserted it rather than relying on an error).
-- Fix (clone-side only; production ACL untouched):
REVOKE ALL ON FUNCTION public.run_rls_subscription_tests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_rls_subscription_tests() TO service_role;
