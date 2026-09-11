-- 情境測試：在交易內 seed，最後 ROLLBACK，不留資料。需先套用 001。
-- 執行：psql "$URL" -v ON_ERROR_STOP=1 -f db/subscriber-expiry/090_scenarios.sql
BEGIN;
SET LOCAL search_path = public;

-- fixture ------------------------------------------------------------------
-- now = 2026-09-11 18:30 Asia/Taipei = 10:30Z
CREATE TEMP TABLE t_ctx AS SELECT '2026-09-11T10:30:00Z'::timestamptz AS now_ts;
INSERT INTO public.experts (id, user_id, slug, name, role, status) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-00000000000a', 't-a', '老師A', 'mentor', 'active'),
 ('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-1111-0000-0000-00000000000b', 't-b', '老師B', 'mentor', 'active'),
 ('cccccccc-0000-0000-0000-00000000000c', NULL,                                   't-c', '無帳號', 'mentor', 'active');
INSERT INTO public.expert_plans (id, expert_id, name) VALUES
 ('aaaaaaaa-2222-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A 週記'),
 ('bbbbbbbb-2222-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 'B 週記'),
 ('cccccccc-2222-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-00000000000c', 'C 週記');
INSERT INTO public.profiles (user_id, display_name) VALUES
 ('11111111-0000-0000-0000-000000000001', '小明'),
 ('11111111-0000-0000-0000-000000000002', ''),
 ('11111111-0000-0000-0000-000000000003', '小美');
-- 訂閱（A 老師）
INSERT INTO public.member_subscriptions (id, user_id, plan_id, status, expires_at, canceled_at) VALUES
 -- 3 天：9/14 12:00 台北
 ('50000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', '2026-09-14T04:00:00Z', NULL),
 -- 7 天邊界：9/18 23:59 台北（=15:59Z）
 ('50000000-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000002', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', '2026-09-18T15:59:00Z', NULL),
 -- 8 天：9/19 00:30 台北（UTC 仍是 9/18 16:30 → 若用 UTC 會誤判成 7 天）
 ('50000000-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000003', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', '2026-09-18T16:30:00Z', NULL),
 -- 1 天：9/12 08:00 台北 = 9/12 00:00Z
 ('50000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', '2026-09-12T00:00:00Z', NULL),
 -- 0 天：9/11 23:00 台北（尚未過期）
 ('50000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', '2026-09-11T15:00:00Z', NULL),
 -- 已過期（今日稍早）status 仍 active → 排除
 ('50000000-0000-0000-0000-00000000000e', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', '2026-09-11T01:00:00Z', NULL),
 -- 取消 → 排除
 ('50000000-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-00000000000a', 'canceled', '2026-09-13T04:00:00Z', '2026-09-01T00:00:00Z'),
 -- active 但 canceled_at 有值 → 排除
 ('50000000-0000-0000-0000-00000000000d', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', '2026-09-13T04:00:00Z', '2026-09-01T00:00:00Z'),
 -- 無到期日 → 排除
 ('50000000-0000-0000-0000-00000000000f', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-00000000000a', 'active', NULL, NULL),
 -- B 老師 2 天
 ('60000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-00000000000b', 'active', '2026-09-13T04:00:00Z', NULL),
 -- C 老師（無 user_id）3 天 → 排除
 ('70000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-00000000000c', 'active', '2026-09-14T04:00:00Z', NULL);
-- 健檢訂閱（其他商品）→ 不在 member_subscriptions，自然排除
INSERT INTO public.checkup_subscriptions (user_id, status, expires_at) VALUES ('11111111-0000-0000-0000-000000000001','active','2026-09-13T04:00:00Z');

-- helper -------------------------------------------------------------------
CREATE TEMP TABLE t_results (name text, passed boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.chk(name text, cond boolean, detail text DEFAULT '') RETURNS void LANGUAGE sql AS
$$ INSERT INTO t_results VALUES (name, cond, detail) $$;

-- T1 A 老師名單：3/7/1/0 天納入，8 天/過期/取消/無到期/無 mapping 排除
SELECT pg_temp.chk('A: days_left set = {0,1,3,7}',
  (SELECT array_agg(days_left ORDER BY days_left) FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE expert_id='aaaaaaaa-0000-0000-0000-00000000000a') = ARRAY[0,1,3,7],
  (SELECT string_agg(days_left::text, ',' ORDER BY days_left) FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE expert_id='aaaaaaaa-0000-0000-0000-00000000000a'));
SELECT pg_temp.chk('UTC 跨日：8 天(台北 9/19 00:30) 不納入',
  NOT EXISTS (SELECT 1 FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE subscription_id='50000000-0000-0000-0000-000000000008'));
SELECT pg_temp.chk('7 天邊界(台北 9/18 23:59) 納入',
  EXISTS (SELECT 1 FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE subscription_id='50000000-0000-0000-0000-000000000007' AND days_left=7));
SELECT pg_temp.chk('已過期(今日稍早) 排除',
  NOT EXISTS (SELECT 1 FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE subscription_id='50000000-0000-0000-0000-00000000000e'));
SELECT pg_temp.chk('無 user_id 老師 排除',
  NOT EXISTS (SELECT 1 FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE expert_id='cccccccc-0000-0000-0000-00000000000c'));
SELECT pg_temp.chk('空 display_name → 訂閱者 fallback，且無 email 欄位',
  (SELECT display_name FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE subscription_id='50000000-0000-0000-0000-000000000007') = '訂閱者'
  AND NOT EXISTS (SELECT 1 FROM information_schema.routines r JOIN information_schema.parameters p ON p.specific_name=r.specific_name WHERE r.routine_name='expiring_subscriptions_for_expert' AND p.parameter_name ILIKE '%email%'));

-- T2 claim：18:30 > 18:00 → A、B 都到時間；claim 2 筆；重跑 0 筆
CREATE TEMP TABLE t_run1 AS SELECT public.claim_subscriber_expiry_reminders((SELECT now_ts FROM t_ctx)) AS r;
SELECT pg_temp.chk('run1 claimed=2, due_experts=2, due_subscriptions=5', (SELECT (r->>'claimed')::int=2 AND (r->>'due_experts')::int=2 AND (r->>'due_subscriptions')::int=5 FROM t_run1), (SELECT (r - 'batches')::text FROM t_run1));
SELECT pg_temp.chk('run1 A batch count=4 items 含 display_name/plan_name/expires_on/days_left，不含 email',
  (SELECT bool_and((b->>'subscription_count')::int = CASE WHEN b->>'expert_slug'='t-a' THEN 4 ELSE 1 END
     AND (b->'items'->0) ?& ARRAY['display_name','plan_name','expires_on','days_left'] AND NOT ((b->'items'->0) ? 'email'))
   FROM t_run1, jsonb_array_elements(r->'batches') b));
CREATE TEMP TABLE t_run2 AS SELECT public.claim_subscriber_expiry_reminders((SELECT now_ts FROM t_ctx)) AS r;
SELECT pg_temp.chk('run2 重跑 claimed=0 deduped=2', (SELECT (r->>'claimed')::int=0 AND (r->>'deduped')::int=2 FROM t_run2), (SELECT (r - 'batches')::text FROM t_run2));
SELECT pg_temp.chk('ledger 每老師每日一筆', (SELECT count(*)=2 FROM public.subscriber_expiry_reminders WHERE local_date='2026-09-11'));

-- T3 時間門：17:30 台北時 B 尚未到（B 設 18:00），A 設 17:00 → 只 A
UPDATE public.experts SET journal_reminder_time='17:00' WHERE id='aaaaaaaa-0000-0000-0000-00000000000a';
DELETE FROM public.subscriber_expiry_reminders;
SELECT pg_temp.chk('17:30 只 claim A（17:00）不 claim B（18:00）',
  (SELECT (r->>'claimed')::int=1 AND r->'batches'->0->>'expert_slug'='t-a' FROM public.claim_subscriber_expiry_reminders('2026-09-11T09:30:00Z'::timestamptz) r));
-- 非台北時區：B 改 America/New_York 06:00；台北 18:30 = NY 06:30 → 到時間；local_date 為 NY 的 9/11
UPDATE public.experts SET journal_reminder_timezone='America/New_York', journal_reminder_time='06:00' WHERE id='bbbbbbbb-0000-0000-0000-00000000000b';
SELECT pg_temp.chk('NY 老師 06:30 local 到時間、local_date=2026-09-11',
  (SELECT (r->>'claimed')::int=1 AND r->'batches'->0->>'local_date'='2026-09-11' FROM public.claim_subscriber_expiry_reminders((SELECT now_ts FROM t_ctx)) r));
-- 無效時區被 trigger 擋下
DO $$ BEGIN
  BEGIN
    UPDATE public.experts SET journal_reminder_timezone='Mars/Olympus' WHERE id='bbbbbbbb-0000-0000-0000-00000000000b';
    PERFORM pg_temp.chk('無效時區被拒', false);
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.chk('無效時區被拒', true, SQLERRM); END;
END $$;

-- T4 續訂 → 移出；改派老師 → 立刻反映（無 snapshot）
UPDATE public.member_subscriptions SET expires_at='2026-10-14T04:00:00Z' WHERE id='50000000-0000-0000-0000-000000000003';
SELECT pg_temp.chk('續訂後 3 天那筆移出', NOT EXISTS (SELECT 1 FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE subscription_id='50000000-0000-0000-0000-000000000003'));
UPDATE public.expert_plans SET expert_id='bbbbbbbb-0000-0000-0000-00000000000b' WHERE id='aaaaaaaa-2222-0000-0000-00000000000a';
SELECT pg_temp.chk('改派老師後 A 名單為空、B 取得', 
  NOT EXISTS (SELECT 1 FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE expert_id='aaaaaaaa-0000-0000-0000-00000000000a')
  AND (SELECT count(*)=4 FROM public._expiring_subscriptions_by_expert((SELECT now_ts FROM t_ctx)) WHERE expert_id='bbbbbbbb-0000-0000-0000-00000000000b'));
UPDATE public.expert_plans SET expert_id='aaaaaaaa-0000-0000-0000-00000000000a' WHERE id='aaaaaaaa-2222-0000-0000-00000000000a';

-- T5 ownership：A 可讀 A；A 讀 B → 42501；匿名 → 42501；admin 可讀任一
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-0000-0000-00000000000a', true);
SELECT pg_temp.chk('A 讀自己 OK（>=1 筆，欄位無 email）', (SELECT count(*)>=1 FROM public.expiring_subscriptions_for_expert('aaaaaaaa-0000-0000-0000-00000000000a')));
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.expiring_subscriptions_for_expert('bbbbbbbb-0000-0000-0000-00000000000b');
    PERFORM pg_temp.chk('A 讀 B 被拒', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk('A 讀 B 被拒', true, SQLERRM); END;
END $$;
SELECT pg_temp.chk('A 只看到自己 ledger（RLS）', (SELECT bool_and(expert_id='aaaaaaaa-0000-0000-0000-00000000000a') FROM public.subscriber_expiry_reminders) IS NOT FALSE);
DO $$ BEGIN
  BEGIN
    PERFORM public.claim_subscriber_expiry_reminders(now());
    PERFORM pg_temp.chk('authenticated 不能呼叫 claim', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk('authenticated 不能呼叫 claim', true); END;
  BEGIN
    PERFORM * FROM public._expiring_subscriptions_by_expert(now());
    PERFORM pg_temp.chk('authenticated 不能呼叫內部 query', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk('authenticated 不能呼叫內部 query', true); END;
END $$;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.expiring_subscriptions_for_expert('aaaaaaaa-0000-0000-0000-00000000000a');
    PERFORM pg_temp.chk('匿名被拒', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk('匿名被拒', true); END;
END $$;
RESET ROLE;
INSERT INTO public.user_roles (user_id, role) VALUES ('99999999-0000-0000-0000-000000000009','company_admin');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000009', true);
SELECT pg_temp.chk('admin 可讀 B', (SELECT count(*)>=1 FROM public.expiring_subscriptions_for_expert('bbbbbbbb-0000-0000-0000-00000000000b')));
RESET ROLE;

-- report -------------------------------------------------------------------
SELECT name, passed, detail FROM t_results;
DO $$ DECLARE f int; BEGIN
  SELECT count(*) INTO f FROM t_results WHERE NOT passed;
  IF f > 0 THEN RAISE EXCEPTION 'SCENARIOS FAILED: %', f; END IF;
  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;
ROLLBACK;
