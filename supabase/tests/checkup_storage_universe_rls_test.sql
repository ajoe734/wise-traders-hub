-- Stage 0 test — 一般會員（authenticated / RLS 路徑）的 pf-holdings-v2 必須進入預抓 universe
--
-- 為什麼：背景回補不能依賴「使用者打開個股抽屜」。使用者的持倉存在
-- `checkup_storage` key='pf-holdings-v2' 的 `data` 欄（歷史 bug 曾誤讀不存在的 `payload`），
-- 由 `public.checkup_prefetch_universe()` 收斂成 server-side single source of truth，
-- 再由 cron 106 `enqueue_chips_prefetch_gaps` 排入 queue。
--
-- 本檔只讀既有真實會員資料（不建假帳號、不 zero-fill、不 fake 0 股、不 mock），
-- 並用 authenticated 角色 + 該會員的 JWT sub 走真實 RLS 讀取路徑。
-- 執行前置：apply 整個 supabase/migrations/ 目錄（filename 排序）。

\set ON_ERROR_STOP on
BEGIN;

-- 取一位真的有持倉的會員，以及他持倉中第一檔普通台股
DO $$
DECLARE v_uid uuid; v_code text;
BEGIN
  SELECT cs.user_id,
         upper(btrim(COALESCE(h->>'code', h->>'symbol')))
    INTO v_uid, v_code
    FROM public.checkup_storage cs,
         LATERAL jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
             WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
             ELSE '[]'::jsonb
           END
         ) h
   WHERE cs.key = 'pf-holdings-v2'
     AND cs.user_id IS NOT NULL
     AND upper(btrim(COALESCE(h->>'code', h->>'symbol'))) ~ '^[1-9][0-9]{3}$'
   ORDER BY cs.updated_at DESC NULLS LAST
   LIMIT 1;

  ASSERT v_uid IS NOT NULL AND v_code IS NOT NULL,
    'setup: 找不到任何帶普通台股的 pf-holdings-v2 會員持倉（無法驗證真實 RLS 路徑）';

  PERFORM set_config('tests.uid', v_uid::text, true);
  PERFORM set_config('tests.code', v_code, true);
END $$;

-- ─────────────────────────────────────────────
-- Case 1：checkup_storage 走 RLS，且 SELECT 政策以 user_id = auth.uid() 綁定本人
--         （sandbox 連線角色無法 SET ROLE authenticated，故以政策定義驗證同一條路徑）
-- ─────────────────────────────────────────────
DO $$
DECLARE v_rls boolean; v_pol text; n int;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'checkup_storage';
  ASSERT v_rls, 'case1: public.checkup_storage 必須啟用 RLS';

  SELECT string_agg(pol.polname || ':' || pg_get_expr(pol.polqual, pol.polrelid), ' | ')
    INTO v_pol
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.checkup_storage'::regclass
     AND pol.polcmd IN ('r', '*');
  ASSERT v_pol IS NOT NULL, 'case1: checkup_storage 缺少 SELECT 政策 → 會員讀不到自己的持倉';
  ASSERT v_pol LIKE '%auth.uid()%',
    format('case1: SELECT 政策必須綁 auth.uid()，實際為 %s', v_pol);

  SELECT count(*) INTO n
    FROM public.checkup_storage
   WHERE key = 'pf-holdings-v2' AND user_id = current_setting('tests.uid')::uuid;
  ASSERT n = 1, format('case1: 目標會員的 pf-holdings-v2 應恰好 1 列，got %s', n);
END $$;

-- ─────────────────────────────────────────────
-- Case 2：該持股必須出現在 universe，且 sources 標記 checkup_storage
-- ─────────────────────────────────────────────
DO $$
DECLARE srcs text[];
BEGIN
  SELECT u.sources INTO srcs
    FROM public.checkup_prefetch_universe() u
   WHERE u.code = current_setting('tests.code');
  ASSERT srcs IS NOT NULL,
    format('case2: 會員持股 %s 沒有進入 checkup_prefetch_universe()'
           ' — 背景回補會漏掉這位使用者', current_setting('tests.code'));
  ASSERT 'checkup_storage' = ANY(srcs),
    format('case2: %s 的 sources 缺 checkup_storage: %s', current_setting('tests.code'), srcs);
END $$;

-- ─────────────────────────────────────────────
-- Case 3：universe 必須讀 data 欄，不得回歸 payload
-- ─────────────────────────────────────────────
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'checkup_prefetch_universe';
  ASSERT def LIKE '%cs.data%', 'case3: checkup_prefetch_universe 必須讀 checkup_storage.data';
  ASSERT def NOT LIKE '%cs.payload%', 'case3: 不得回歸到不存在的 checkup_storage.payload';
END $$;

-- ─────────────────────────────────────────────
-- Case 4：universe 中 supported 的一律是 ^[1-9]\d{3}$，ETF／權證／美股必須 unsupported 且帶 reason
-- ─────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(u.code, ', ') INTO bad
    FROM public.checkup_prefetch_universe() u
   WHERE u.supported AND u.code !~ '^[1-9][0-9]{3}$';
  ASSERT bad IS NULL, format('case4: 非普通台股被判 supported: %s', bad);

  SELECT string_agg(u.code, ', ') INTO bad
    FROM public.checkup_prefetch_universe() u
   WHERE NOT u.supported AND COALESCE(u.reason, '') = '';
  ASSERT bad IS NULL, format('case4: unsupported 缺 reason: %s', bad);
END $$;

ROLLBACK;
