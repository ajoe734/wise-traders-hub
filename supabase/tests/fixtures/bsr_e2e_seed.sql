-- Build2 P4 — ephemeral-only 契約種子（逐字取自 production migrations，不含任何業務資料）
--   quota pools ← 20260725112625_708fd9db-...sql
--   demo_seed   ← 20260810060708_ba8b1818-...sql
-- 用途：讓 finmind_admit_v2_test / chips_prefetch_universe_test / bsr_metrics_contract_test
--       能在 ephemeral cluster 上以與 production 相同的 seed 前提執行。
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_setting('bsr.ephemeral', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'refuse to seed: 非 ephemeral cluster';
  END IF;
END $$;

INSERT INTO public.finmind_quota_pools (pool_name, daily_budget, priority) VALUES
  ('interactive', 240, 1),
  ('keepwarm',    240, 5),
  ('backfill',    120, 9)
ON CONFLICT (pool_name) DO NOTHING;

INSERT INTO public.chips_prefetch_targets (code, source, active, supported, reason)
SELECT c.code, 'demo_seed', true,
       COALESCE((public.tw_bsr_eligibility(c.code)->>'eligible')::boolean, false),
       public.tw_bsr_eligibility(c.code)->>'ineligible_reason'
FROM (VALUES
  ('00637L'),('039108'),('053848'),('702157'),('1503'),('1717'),('2308'),('2313'),
  ('2543'),('3006'),('3013'),('3017'),('3231'),('3443'),('3491'),('4583'),
  ('6274'),('6770'),('6862'),('8227')
) AS c(code)
ON CONFLICT (code) DO UPDATE
  SET source    = 'demo_seed',
      active    = true,
      supported = EXCLUDED.supported,
      reason    = EXCLUDED.reason;
