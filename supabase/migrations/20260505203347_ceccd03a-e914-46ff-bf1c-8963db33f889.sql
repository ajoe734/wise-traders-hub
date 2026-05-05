-- 1) checkup_knowledge_items: lifecycle 欄位
ALTER TABLE public.checkup_knowledge_items
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','candidate','rescue','archived')),
  ADD COLUMN IF NOT EXISTS rescue_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS rescue_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS candidate_observed_since timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text;

-- 從現有 is_active 推斷
UPDATE public.checkup_knowledge_items
SET lifecycle_status = CASE WHEN is_active THEN 'active' ELSE 'archived' END
WHERE lifecycle_status = 'active' AND is_active = false;

CREATE INDEX IF NOT EXISTS idx_knowledge_items_lifecycle
  ON public.checkup_knowledge_items(lifecycle_status)
  WHERE lifecycle_status IN ('active','rescue','candidate');

-- 2) knowledge_auto_rules: 新增三個排程參數
ALTER TABLE public.knowledge_auto_rules
  ADD COLUMN IF NOT EXISTS daily_grid_search_quota int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS rescue_max_weeks int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS candidate_observe_days int NOT NULL DEFAULT 14;