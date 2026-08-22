-- Stage 0 RED test — 一般會員（authenticated / RLS 路徑）的 pf-holdings-v2 必須進入預抓 universe
--
-- 為什麼：背景回補不能依賴「使用者打開個股抽屜」。使用者的持倉存在
-- `checkup_storage` key='pf-holdings-v2' 的 `data` 欄（歷史 bug 曾誤讀 `payload`），
-- 由 `public.checkup_prefetch_universe()` 收斂成 server-side single source of truth，
-- 再由 cron 106 `enqueue_chips_prefetch_gaps` 排入 queue。
--
-- 本檔用真實 authenticated 身分寫入，禁止 zero-fill / fake 0 股 / mock。
-- 執行前置：apply 整個 supabase/migrations/ 目錄（filename 排序）。

\set ON_ERROR_STOP on
BEGIN;

-- 建立一個測試使用者（僅在交易內存在，最後 ROLLBACK）
DO $$
DECLARE uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'stage0-universe-' || uid || '@example.test', '', now(), now(), now());
  PERFORM set_config('tests.uid', uid::text, true);
END $$;

-- 以 authenticated 身分（JWT claims 指定 sub）寫入持倉
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('tests.uid'), 'role', 'authenticated')::text,
                  true);

INSERT INTO public.checkup_storage (user_id, key, data)
VALUES (current_setting('tests.uid')::uuid, 'pf-holdings-v2',
        jsonb_build_array(
          jsonb_build_object('code', '2317', 'name', '鴻海', 'shares', 2000),
          jsonb_build_object('code', '00637L', 'name', '元大滬深300正2', 'shares', 1000)
        ));

RESET ROLE;

-- ─────────────────────────────────────────────
-- Case 1：會員持股必須出現在 universe，且 sources 標記 checkup_storage
-- ─────────────────────────────────────────────
DO $$
DECLARE srcs text[];
BEGIN
  SELECT u.sources INTO srcs FROM public.checkup_prefetch_universe() u WHERE u.code = '2317';
  ASSERT srcs IS NOT NULL,
    'case1: 會員 pf-holdings-v2 的 2317 沒有進入 checkup_prefetch_universe() '
    '— 代表 universe 沒讀到 checkup_storage.data（歷史 payload bug 回歸）';
  ASSERT 'checkup_storage' = ANY(srcs),
    format('case1: 2317 的 sources 缺 checkup_storage: %s', srcs);
END $$;

-- ─────────────────────────────────────────────
-- Case 2：資料來源必須是 data 欄，不是 payload
-- ─────────────────────────────────────────────
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'checkup_prefetch_universe';
  ASSERT def LIKE '%cs.data%', 'case2: checkup_prefetch_universe 必須讀 checkup_storage.data';
  ASSERT def NOT LIKE '%cs.payload%', 'case2: 不得回歸到不存在的 checkup_storage.payload';
END $$;

-- ─────────────────────────────────────────────
-- Case 3：ETF 不得被判定 supported（不製造假 failed job）
-- ─────────────────────────────────────────────
DO $$
DECLARE sup boolean; rsn text;
BEGIN
  SELECT u.supported, u.reason INTO sup, rsn
    FROM public.checkup_prefetch_universe() u WHERE u.code = '00637L';
  ASSERT sup IS NOT NULL, 'case3: 00637L 應該進 universe（只是 unsupported）';
  ASSERT sup = false, 'case3: ETF 00637L 不得判定為 BSR supported';
  ASSERT rsn IS NOT NULL, 'case3: unsupported 必須帶 reason';
END $$;

ROLLBACK;
