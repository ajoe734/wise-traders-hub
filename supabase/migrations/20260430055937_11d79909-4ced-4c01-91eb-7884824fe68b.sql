-- 1. 回填進度追蹤表
CREATE TABLE IF NOT EXISTS public.knowledge_backfill_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  yyyymm text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | done | failed | empty
  rows_inserted integer NOT NULL DEFAULT 0,
  attempted_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, yyyymm)
);

CREATE INDEX IF NOT EXISTS idx_backfill_status ON public.knowledge_backfill_progress(status);
CREATE INDEX IF NOT EXISTS idx_backfill_symbol ON public.knowledge_backfill_progress(symbol);

ALTER TABLE public.knowledge_backfill_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage backfill progress"
ON public.knowledge_backfill_progress
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 2. 自動淘弱加強規則設定表（單列 singleton 設定）
CREATE TABLE IF NOT EXISTS public.knowledge_auto_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  archive_below_win_rate numeric NOT NULL DEFAULT 0.40, -- 勝率低於此值 → 歸檔停用
  promote_above_win_rate numeric NOT NULL DEFAULT 0.70, -- 勝率高於此值 → 提升信心度
  min_sample_size integer NOT NULL DEFAULT 30,          -- 最小樣本門檻
  auto_grid_search_below numeric NOT NULL DEFAULT 0.55, -- 勝率低於此但高於 archive → 自動跑網格
  promote_min_improvement_pct numeric NOT NULL DEFAULT 5,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_auto_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage auto rules"
ON public.knowledge_auto_rules
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 預設一筆設定（停用狀態）
INSERT INTO public.knowledge_auto_rules (enabled)
SELECT false
WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_auto_rules);

-- 3. 在 backtest_runs 加 auto_action 欄位記錄自動規則動作
ALTER TABLE public.knowledge_backtest_runs
  ADD COLUMN IF NOT EXISTS auto_action text,        -- 'archived' | 'promoted_confidence' | 'auto_grid' | 'none'
  ADD COLUMN IF NOT EXISTS auto_action_reason text;