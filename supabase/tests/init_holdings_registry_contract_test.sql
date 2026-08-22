-- Stage 0 RED test — INIT_HOLDINGS ↔ registry ↔ eligibility 契約
--
-- 硬規則：20 檔 demo 種子只有一個 server-side 來源
-- （`public.chips_prefetch_targets` source='demo_seed'，由 migration 20260810060708 種下）。
-- 本檔一律從 registry 讀，**不得把 20 個代號硬編碼散落到 SQL**；分類必須由
-- `public.tw_bsr_eligibility()` 決定，而不是人工維護的名單。
--
-- 執行前置：apply 整個 supabase/migrations/ 目錄（filename 排序）。

\set ON_ERROR_STOP on
BEGIN;

-- ─────────────────────────────────────────────
-- Case 1：registry 是唯一來源，且 16 supported / 4 unsupported
-- ─────────────────────────────────────────────
DO $$
DECLARE n int; n_sup int; n_unsup int;
BEGIN
  SELECT count(*) INTO n FROM public.chips_prefetch_targets WHERE source = 'demo_seed' AND active;
  ASSERT n = 20, format('case1: active demo_seed rows expect 20 got %s', n);

  SELECT count(*) FILTER (WHERE supported), count(*) FILTER (WHERE NOT supported)
    INTO n_sup, n_unsup
    FROM public.chips_prefetch_targets WHERE source = 'demo_seed' AND active;
  ASSERT n_sup = 16,  format('case1: supported expect 16 got %s', n_sup);
  ASSERT n_unsup = 4, format('case1: unsupported expect 4 got %s', n_unsup);
END $$;

-- ─────────────────────────────────────────────
-- Case 2：registry 的 supported 欄必須與 tw_bsr_eligibility() 即時判定一致
--         （registry 只是快取，權威在 eligibility 函式）
-- ─────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.code || ':' || t.supported || '<>' ||
                    COALESCE((public.tw_bsr_eligibility(t.code)->>'eligible'), 'null'), ', ')
    INTO bad
    FROM public.chips_prefetch_targets t
   WHERE t.source = 'demo_seed' AND t.active
     AND t.supported IS DISTINCT FROM
         COALESCE((public.tw_bsr_eligibility(t.code)->>'eligible')::boolean, false);
  ASSERT bad IS NULL, format('case2: registry.supported drifted from tw_bsr_eligibility(): %s', bad);
END $$;

-- ─────────────────────────────────────────────
-- Case 3：只有 ^[1-9]\d{3}$ 普通台股可以 supported；其餘必須帶 reason
-- ─────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(code, ', ') INTO bad
    FROM public.chips_prefetch_targets
   WHERE source = 'demo_seed' AND active AND supported AND code !~ '^[1-9][0-9]{3}$';
  ASSERT bad IS NULL, format('case3: 非普通台股被判定 supported: %s', bad);

  SELECT string_agg(code, ', ') INTO bad
    FROM public.chips_prefetch_targets
   WHERE source = 'demo_seed' AND active AND NOT supported
     AND COALESCE(reason, '') NOT IN ('invalid_stock_id', 'unsupported_asset_type');
  ASSERT bad IS NULL, format('case3: unsupported 缺少可辨識 reason: %s', bad);
END $$;

-- ─────────────────────────────────────────────
-- Case 4：unsupported 標的不得產生任何 BSR queue job（不製造假 failed job）
-- ─────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(q.stock_id || ':' || q.status, ', ') INTO bad
    FROM public.tw_bsr_sync_queue q
    JOIN public.chips_prefetch_targets t ON t.code = q.stock_id
   WHERE t.source = 'demo_seed' AND t.active AND NOT t.supported;
  ASSERT bad IS NULL, format('case4: unsupported 標的出現 queue job: %s', bad);
END $$;

ROLLBACK;
