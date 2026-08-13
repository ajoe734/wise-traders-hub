-- PR-10: finmind_admit_v2 SQL 契約測試（non-required，於 postgres container 跑）
-- workflow: .github/workflows/finmind-admit-sql-tests.yml
-- 執行前置：apply 整個 supabase/migrations/ 目錄（filename 排序）。
-- 晉升為 required 條件：見 docs/ops/chips-pipeline-runbook.md §5。

\set ON_ERROR_STOP on
BEGIN;

-- 清乾淨：測試環境隔離
TRUNCATE public.finmind_quota_pools RESTART IDENTITY CASCADE;
TRUNCATE public.finmind_quota_ledger RESTART IDENTITY CASCADE;

-- Seed 三池
INSERT INTO public.finmind_quota_pools
  (pool_name, capacity, tokens, daily_budget, base_daily_budget, refill_per_min, updated_at)
VALUES
  ('interactive', 100, 100, 100, 100, 5, now()),
  ('keepwarm',    100, 100, 100, 100, 5, now()),
  ('backfill',    100, 100, 100, 100, 5, now());

-- Case 1：keepwarm 有 token → grant，remaining 減 1
DO $$
DECLARE r jsonb;
BEGIN
  r := public.finmind_admit_v2(_pool := 'keepwarm', _kind := 'test', _stock_id := NULL, _cost := 1, _allow_borrow := false);
  ASSERT (r->>'granted')::boolean = true, format('case1: expect granted=true got %s', r);
END $$;

-- Case 2：keepwarm 用光 → deny
UPDATE public.finmind_quota_pools SET tokens = 0 WHERE pool_name = 'keepwarm';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.finmind_admit_v2(_pool := 'keepwarm', _kind := 'test', _stock_id := NULL, _cost := 1, _allow_borrow := false);
  ASSERT (r->>'granted')::boolean = false, format('case2: expect granted=false got %s', r);
END $$;

-- Case 3：interactive 當日額度用光 + allow_borrow=true → 從 keepwarm 借
-- production 語意：借用分支只在「日額度耗盡」(used_today + cost > daily_budget) 時進入，
-- 且要求 keepwarm.tokens - cost >= capacity * 0.3（保留水位）。
-- 因此前提必須真實重現「過去 24h 已把 interactive 日額度用完」，而不是只把 tokens 歸零
-- （tokens=0 只會走 token bucket 的 rate_limited 分支，與借用無關）。
UPDATE public.finmind_quota_pools
   SET tokens = 0,
       used_today = daily_budget,          -- 日額度耗盡
       reset_at = (now() AT TIME ZONE 'Asia/Taipei')::date,
       last_refill_at = now()
 WHERE pool_name = 'interactive';

-- 24h ledger seed：與 used_today 對齊的實際扣點紀錄（production 每次 grant 都會落地一列）
INSERT INTO public.finmind_quota_ledger (pool_name, request_kind, stock_id, granted, reason, created_at)
SELECT 'interactive', 'test', NULL, true, 'granted',
       now() - (g * interval '10 minutes')
  FROM generate_series(1, (SELECT daily_budget FROM public.finmind_quota_pools WHERE pool_name='interactive')) g
 WHERE now() - (g * interval '10 minutes') > now() - interval '24 hours';

-- keepwarm 必須高於 30% 保留水位才可出借
UPDATE public.finmind_quota_pools
   SET tokens = COALESCE(capacity, daily_budget)::numeric,
       used_today = 0,
       reset_at = (now() AT TIME ZONE 'Asia/Taipei')::date,
       last_refill_at = now()
 WHERE pool_name = 'keepwarm';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.finmind_admit_v2(_pool := 'interactive', _kind := 'test', _stock_id := NULL, _cost := 1, _allow_borrow := true);
  ASSERT (r->>'granted')::boolean = true, format('case3: expect granted (borrow) got %s', r);
  ASSERT r ? 'borrowed_from', format('case3: expect borrowed_from field, got %s', r);
END $$;

-- Case 4：interactive 用光 + allow_borrow=false → deny
UPDATE public.finmind_quota_pools SET tokens = 0 WHERE pool_name = 'interactive';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.finmind_admit_v2(_pool := 'interactive', _kind := 'test', _stock_id := NULL, _cost := 1, _allow_borrow := false);
  ASSERT (r->>'granted')::boolean = false, format('case4: expect denied got %s', r);
END $$;

ROLLBACK;

\echo 'finmind_admit_v2 contract tests: all cases passed'
