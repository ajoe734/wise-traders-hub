-- 1. 純函數：單筆訂閱期間內是否涵蓋 signal 發布時間（含 mentor 7 天回溯）
CREATE OR REPLACE FUNCTION public.signal_in_subscription_window(
  _role expert_role,
  _started_at timestamptz,
  _expires_at timestamptz,
  _published_at timestamptz
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _role = 'mentor' THEN
      (_published_at + INTERVAL '7 days') >= _started_at
      AND (_expires_at IS NULL OR _published_at <= _expires_at)
    ELSE
      _published_at >= _started_at
      AND (_expires_at IS NULL OR _published_at <= _expires_at)
  END
$$;

-- 2. 重構 has_active_subscription_after 使用共用純函數（行為完全相同）
CREATE OR REPLACE FUNCTION public.has_active_subscription_after(
  _user_id uuid,
  _published_at timestamptz
) RETURNS TABLE(expert_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  WHERE ms.user_id = _user_id
    AND public.signal_in_subscription_window(e.role, ms.started_at, ms.expires_at, _published_at)
    -- 且該使用者目前對此老師仍有 active 訂閱（付費牆：斷約後失去存取，續訂即解鎖歷史）
    AND EXISTS (
      SELECT 1
      FROM public.member_subscriptions ms2
      JOIN public.expert_plans ep2 ON ep2.id = ms2.plan_id
      WHERE ms2.user_id = _user_id
        AND ep2.expert_id = ep.expert_id
        AND ms2.status = 'active'
        AND (ms2.expires_at IS NULL OR ms2.expires_at > now())
    )
$$;

-- 3. RLS 測試套件：涵蓋過期續訂、空窗期、7 天回溯
--    直接測試純視窗函數 + 端到端測試 has_active_subscription_after（真實 seed，交易內 rollback）
CREATE OR REPLACE FUNCTION public.run_rls_subscription_tests()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := '2026-07-14 12:00:00+08'::timestamptz;
  v_user uuid := '00000000-0000-0000-0000-0000000000aa'::uuid;
  v_user_gap uuid := '00000000-0000-0000-0000-0000000000bb'::uuid;
  v_user_expired uuid := '00000000-0000-0000-0000-0000000000cc'::uuid;
  v_expert_mentor uuid;
  v_expert_advisor uuid;
  v_plan_m uuid;
  v_plan_a uuid;
  v_visible boolean;
  v_seen boolean;
BEGIN
  -- === Part A：純視窗函數單元測試（不需 seed）===
  test_name := 'mentor: signal within window'; detail := '';
  passed := public.signal_in_subscription_window(
    'mentor'::expert_role,
    '2026-06-01'::timestamptz, '2026-07-01'::timestamptz,
    '2026-06-15'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: 7-day lookback within 7d before start → visible';
  passed := public.signal_in_subscription_window(
    'mentor'::expert_role,
    '2026-06-08'::timestamptz, '2026-07-08'::timestamptz,
    '2026-06-02'::timestamptz); -- 6 天前
  RETURN NEXT;

  test_name := 'mentor: 7-day lookback boundary (exactly 7d) → visible';
  passed := public.signal_in_subscription_window(
    'mentor'::expert_role,
    '2026-06-08 12:00+08'::timestamptz, '2026-07-08'::timestamptz,
    '2026-06-01 12:00+08'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: 8d before start → NOT visible';
  passed := NOT public.signal_in_subscription_window(
    'mentor'::expert_role,
    '2026-06-08 12:00+08'::timestamptz, '2026-07-08'::timestamptz,
    '2026-05-31 11:00+08'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: signal after expires_at → NOT visible';
  passed := NOT public.signal_in_subscription_window(
    'mentor'::expert_role,
    '2026-06-01'::timestamptz, '2026-07-01'::timestamptz,
    '2026-07-05'::timestamptz);
  RETURN NEXT;

  test_name := 'advisor: 7-day lookback does NOT apply (1d before start → NOT visible)';
  passed := NOT public.signal_in_subscription_window(
    'advisor'::expert_role,
    '2026-06-08'::timestamptz, '2026-07-08'::timestamptz,
    '2026-06-07'::timestamptz);
  RETURN NEXT;

  test_name := 'advisor: signal exactly at started_at → visible';
  passed := public.signal_in_subscription_window(
    'advisor'::expert_role,
    '2026-06-08 12:00+08'::timestamptz, '2026-07-08'::timestamptz,
    '2026-06-08 12:00+08'::timestamptz);
  RETURN NEXT;

  test_name := 'mentor: no expires_at (unlimited) → future signal visible';
  passed := public.signal_in_subscription_window(
    'mentor'::expert_role,
    '2026-06-01'::timestamptz, NULL,
    '2030-01-01'::timestamptz);
  RETURN NEXT;

  -- === Part B：端到端 RLS 測試（seed 進 auth.users + tables，交易內 SAVEPOINT/rollback）===
  BEGIN
    -- 直接對 auth.users 塞 3 位測試用戶（rollback 前不會留下）
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
    VALUES (v_expert_mentor,  'M', 'monthly'::plan_type, 100, true, 'approved'::plan_review_status)
    RETURNING id INTO v_plan_m;

    INSERT INTO public.expert_plans (expert_id, name, plan_type, price_monthly, is_active, review_status)
    VALUES (v_expert_advisor, 'A', 'monthly'::plan_type, 100, true, 'approved'::plan_review_status)
    RETURNING id INTO v_plan_a;

    -- 情境 1：user A 過期後續訂 → 舊區間內的 signal 應該可見（歷史解鎖）
    -- 舊訂閱：2026-05-10 ~ 2026-06-10（過期）；新訂閱：2026-07-14 ~ 2026-08-14 active
    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES
      (v_user, v_plan_m, 'expired', '2026-05-10'::timestamptz, '2026-06-10'::timestamptz),
      (v_user, v_plan_m, 'active',  '2026-07-14'::timestamptz, '2026-08-14'::timestamptz);

    -- 情境 2：user_gap 只有一段 active（2026-07-14~2026-08-14），舊區間之前無訂閱
    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES (v_user_gap, v_plan_m, 'active', '2026-07-14'::timestamptz, '2026-08-14'::timestamptz);

    -- 情境 3：user_expired 只有過期訂閱，無 active
    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES (v_user_expired, v_plan_m, 'expired', '2026-05-10'::timestamptz, '2026-06-10'::timestamptz);

    -- Test B1：續訂後可看到舊區間內發布的 signal（2026-05-20，落在舊訂閱期間內）
    SELECT EXISTS(
      SELECT 1 FROM public.has_active_subscription_after(v_user, '2026-05-20'::timestamptz)
      WHERE expert_id = v_expert_mentor
    ) INTO v_seen;
    test_name := 'renew after expire: old-window signal is unlocked';
    passed := v_seen;
    detail := CASE WHEN v_seen THEN '' ELSE 'expected visible after renewal' END;
    RETURN NEXT;

    -- Test B2：空窗期 signal（2026-06-20，介於兩段之間、非 7 天回溯內）→ 應不可見
    SELECT EXISTS(
      SELECT 1 FROM public.has_active_subscription_after(v_user, '2026-06-20'::timestamptz)
      WHERE expert_id = v_expert_mentor
    ) INTO v_seen;
    test_name := 'gap window: signal published in gap → NOT visible';
    passed := NOT v_seen;
    detail := CASE WHEN v_seen THEN 'gap signal must NOT be visible' ELSE '' END;
    RETURN NEXT;

    -- Test B3：user_gap 空窗期之前的舊 signal（2026-05-20）→ 沒訂過就是看不到
    SELECT EXISTS(
      SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-05-20'::timestamptz)
      WHERE expert_id = v_expert_mentor
    ) INTO v_seen;
    test_name := 'no prior subscription: pre-active signal → NOT visible';
    passed := NOT v_seen;
    detail := CASE WHEN v_seen THEN 'must not see history user never paid for' ELSE '' END;
    RETURN NEXT;

    -- Test B4：user_gap mentor 7 天回溯（active 於 2026-07-14 起，signal 於 2026-07-08 → 6 天前）
    SELECT EXISTS(
      SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-07-08'::timestamptz)
      WHERE expert_id = v_expert_mentor
    ) INTO v_seen;
    test_name := 'mentor 7d lookback: 6 days before start → visible';
    passed := v_seen;
    detail := CASE WHEN v_seen THEN '' ELSE '7d lookback broken' END;
    RETURN NEXT;

    -- Test B5：user_gap mentor 7 天邊界外（signal 於 2026-07-06 → 8 天前）
    SELECT EXISTS(
      SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-07-06 11:00+08'::timestamptz)
      WHERE expert_id = v_expert_mentor
    ) INTO v_seen;
    test_name := 'mentor 7d lookback: 8 days before start → NOT visible';
    passed := NOT v_seen;
    detail := CASE WHEN v_seen THEN '7d boundary leaks' ELSE '' END;
    RETURN NEXT;

    -- Test B6：user_expired 只有過期訂閱，即使 signal 落在舊區間內也看不到（無 active）
    SELECT EXISTS(
      SELECT 1 FROM public.has_active_subscription_after(v_user_expired, '2026-05-20'::timestamptz)
      WHERE expert_id = v_expert_mentor
    ) INTO v_seen;
    test_name := 'expired only (no active): historical signal → NOT visible';
    passed := NOT v_seen;
    detail := CASE WHEN v_seen THEN 'expired user must not read history' ELSE '' END;
    RETURN NEXT;

    -- Test B7：advisor 不套用 7 天回溯 — 先給 user_gap 一段 advisor active 訂閱
    INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at, expires_at)
    VALUES (v_user_gap, v_plan_a, 'active', '2026-07-14'::timestamptz, '2026-08-14'::timestamptz);

    SELECT EXISTS(
      SELECT 1 FROM public.has_active_subscription_after(v_user_gap, '2026-07-10'::timestamptz)
      WHERE expert_id = v_expert_advisor
    ) INTO v_seen;
    test_name := 'advisor: no 7d lookback (4 days before start) → NOT visible';
    passed := NOT v_seen;
    detail := CASE WHEN v_seen THEN 'advisor should not have 7d lookback' ELSE '' END;
    RETURN NEXT;

    -- 清理：全部 rollback，不留任何測試資料
    RAISE EXCEPTION 'ROLLBACK_TESTS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TESTS' THEN
      test_name := 'seed/execution error';
      passed := false;
      detail := SQLERRM;
      RETURN NEXT;
    END IF;
  END;

  RETURN;
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_rls_subscription_tests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_rls_subscription_tests() TO service_role;