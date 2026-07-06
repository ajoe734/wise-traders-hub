-- 支援多族群 / 題材 / 營收比重的個股 metadata override
ALTER TABLE public.holding_meta_overrides
  ADD COLUMN IF NOT EXISTS industries text[],
  ADD COLUMN IF NOT EXISTS themes text[],
  ADD COLUMN IF NOT EXISTS revenue_mix jsonb;

COMMENT ON COLUMN public.holding_meta_overrides.industries IS
  '多族群（依營收比重降冪排列，industries[0] 為主產業）';
COMMENT ON COLUMN public.holding_meta_overrides.themes IS
  '題材白名單（AI / CoWoS / 高股息 / 車用 等）';
COMMENT ON COLUMN public.holding_meta_overrides.revenue_mix IS
  '營收比重 JSON: [{industry, pct}]，pct 加總 = 100，供加權聚合使用';

-- 版本歷史表同步（若存在）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'holding_meta_override_history') THEN
    EXECUTE 'ALTER TABLE public.holding_meta_override_history
               ADD COLUMN IF NOT EXISTS industries text[],
               ADD COLUMN IF NOT EXISTS themes text[],
               ADD COLUMN IF NOT EXISTS revenue_mix jsonb';
  END IF;
END $$;