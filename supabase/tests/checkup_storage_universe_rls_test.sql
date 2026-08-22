-- Stage 1 整合測試 — 一般會員（authenticated）寫入 → service_role universe 讀得到
--
-- 為什麼：背景回補不能依賴「使用者打開個股抽屜」。會員持倉存在
-- `public.checkup_storage` key='pf-holdings-v2' 的 `data` 欄（歷史 bug 曾誤讀不存在的
-- `payload`），由 `public.checkup_prefetch_universe()`（service_role only）收斂成
-- server-side single source of truth，再由 cron 106 `enqueue_chips_prefetch_gaps` 排入 queue。
--
-- 契約：
--   * 寫入端必須是 authenticated 本人，走真實 RLS（不是 service_role 代寫）。
--   * 讀取端必須是 service_role 執行內部 universe RPC。
--   * 嚴禁為了讓測試通過而 GRANT authenticated EXECUTE 給 universe RPC。
--   * fixture 全部在交易內建立，結束 ROLLBACK，production 不留痕跡。
--
-- 執行方式（必須是 service_role 或 postgres 連線；一般 sandbox 角色會在前置斷言處紅燈）：
--   psql "$SERVICE_ROLE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/checkup_storage_universe_rls_test.sql

\set ON_ERROR_STOP on
BEGIN;

-- ─────────────────────────────────────────────
-- 前置：本檔必須以能執行內部 universe RPC 的角色跑
-- ─────────────────────────────────────────────
DO $$
BEGIN
  ASSERT has_function_privilege(current_user, 'public.checkup_prefetch_universe()', 'EXECUTE'),
    format('setup: current_user=%s 沒有 EXECUTE public.checkup_prefetch_universe() '
           '— 請用 service_role/postgres 執行；禁止 GRANT 給 authenticated 來繞過', current_user);
END $$;

-- ─────────────────────────────────────────────
-- fixture：建立測試會員（交易內，最後 ROLLBACK）
-- ─────────────────────────────────────────────
DO $$
DECLARE uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'stage1-universe-' || replace(uid::text, '-', '') || '@example.test', '',
          now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb);
  PERFORM set_config('tests.uid', uid::text, true);
  -- 挑一檔「目前 universe 內沒有」的普通台股，才能證明是這次寫入把它帶進去的
  PERFORM set_config('tests.code',
    (SELECT c FROM unnest(ARRAY['2404','1229','9958','2515','1590']) c
      WHERE NOT EXISTS (SELECT 1 FROM public.checkup_prefetch_universe() u WHERE u.code = c)
      LIMIT 1), true);
  ASSERT current_setting('tests.code', true) IS NOT NULL,
    'fixture: 候選代號全部已在 universe 中，換一組候選再跑';
END $$;

-- ─────────────────────────────────────────────
-- Case 1：baseline — 寫入前，該代號不在 universe
-- ─────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.checkup_prefetch_universe() u
   WHERE u.code = current_setting('tests.code');
  ASSERT n = 0, format('case1: baseline 應為 0，實得 %s', n);
END $$;

-- ─────────────────────────────────────────────
-- Case 2：以 authenticated 本人身分寫入自己的 checkup_storage.data（走真實 RLS）
-- ─────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('tests.uid'),
                                    'role', 'authenticated',
                                    'aud', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.checkup_storage (user_id, key, data)
VALUES (current_setting('tests.uid')::uuid, 'pf-holdings-v2',
        jsonb_build_array(
          jsonb_build_object('code', current_setting('tests.code'),
                             'name', 'stage1-fixture', 'shares', 2000)));

DO $$
DECLARE n int;
BEGIN
  -- 本人讀得到自己（RLS SELECT 政策）
  SELECT count(*) INTO n FROM public.checkup_storage
   WHERE key = 'pf-holdings-v2' AND user_id = current_setting('tests.uid')::uuid;
  ASSERT n = 1, format('case2: authenticated 本人應讀到 1 列，實得 %s', n);

  -- 不得看到別人的持倉
  SELECT count(*) INTO n FROM public.checkup_storage
   WHERE key = 'pf-holdings-v2' AND user_id <> current_setting('tests.uid')::uuid;
  ASSERT n = 0, format('case2: RLS 破口 — authenticated 看到別人的持倉 %s 列', n);
END $$;

-- ─────────────────────────────────────────────
-- Case 3：authenticated 不得執行內部 universe RPC
-- ─────────────────────────────────────────────
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.checkup_prefetch_universe() LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'case3: authenticated 竟能執行 public.checkup_prefetch_universe() — ACL 被放寬了';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);

-- ─────────────────────────────────────────────
-- Case 4：service_role 執行 universe，必須讀到剛才那筆會員持倉
-- ─────────────────────────────────────────────
DO $$
DECLARE srcs text[]; sup boolean;
BEGIN
  SELECT u.sources, u.supported INTO srcs, sup
    FROM public.checkup_prefetch_universe() u
   WHERE u.code = current_setting('tests.code');
  ASSERT srcs IS NOT NULL,
    format('case4: 會員持股 %s 沒有進入 universe — 背景回補會漏掉這位使用者',
           current_setting('tests.code'));
  ASSERT 'checkup_storage' = ANY(srcs),
    format('case4: sources 缺 checkup_storage: %s', srcs);
  ASSERT sup, format('case4: 普通台股 %s 應為 supported', current_setting('tests.code'));
END $$;

-- ─────────────────────────────────────────────
-- Case 5：universe 必須讀 data 欄，不得回歸 payload
-- ─────────────────────────────────────────────
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'checkup_prefetch_universe';
  ASSERT def LIKE '%cs.data%', 'case5: universe 必須讀 checkup_storage.data';
  ASSERT def NOT LIKE '%cs.payload%', 'case5: 不得回歸到不存在的 checkup_storage.payload';
END $$;

-- ─────────────────────────────────────────────
-- Case 6：supported 一律是 ^[1-9]\d{3}$；unsupported 必須帶 reason
-- ─────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(u.code, ', ') INTO bad FROM public.checkup_prefetch_universe() u
   WHERE u.supported AND u.code !~ '^[1-9][0-9]{3}$';
  ASSERT bad IS NULL, format('case6: 非普通台股被判 supported: %s', bad);

  SELECT string_agg(u.code, ', ') INTO bad FROM public.checkup_prefetch_universe() u
   WHERE NOT u.supported AND COALESCE(u.reason, '') = '';
  ASSERT bad IS NULL, format('case6: unsupported 缺 reason: %s', bad);
END $$;

-- fixture 全部退回
ROLLBACK;
