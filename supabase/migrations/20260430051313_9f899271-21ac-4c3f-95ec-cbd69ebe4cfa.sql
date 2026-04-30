-- 1. 主表新增 8 欄位
ALTER TABLE public.checkup_knowledge_items
  ADD COLUMN IF NOT EXISTS trigger_condition jsonb,
  ADD COLUMN IF NOT EXISTS expected_outcome jsonb,
  ADD COLUMN IF NOT EXISTS win_rate numeric,
  ADD COLUMN IF NOT EXISTS sample_size integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'editorial',
  ADD COLUMN IF NOT EXISTS industry_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS time_horizon text;

-- 2. 候選池表
CREATE TABLE IF NOT EXISTS public.checkup_knowledge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  item_id text,
  title text NOT NULL,
  fact text NOT NULL,
  interpretation text,
  action text,
  lessons text,
  return_pct numeric,
  outcome text,
  confidence numeric DEFAULT 0.6,
  tags text[] DEFAULT '{}',
  trigger_condition jsonb,
  expected_outcome jsonb,
  industry_tags text[] DEFAULT '{}',
  time_horizon text,
  source_type text NOT NULL DEFAULT 'ai_draft',
  source_meta jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  reviewer_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_candidates_status ON public.checkup_knowledge_candidates(status);
CREATE INDEX IF NOT EXISTS idx_kb_candidates_category ON public.checkup_knowledge_candidates(category);

ALTER TABLE public.checkup_knowledge_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage knowledge candidates"
  ON public.checkup_knowledge_candidates
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 3. 驗證紀錄表
CREATE TABLE IF NOT EXISTS public.checkup_knowledge_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_item_id uuid NOT NULL REFERENCES public.checkup_knowledge_items(id) ON DELETE CASCADE,
  hit_id uuid REFERENCES public.checkup_knowledge_hits(id) ON DELETE SET NULL,
  stock_code text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  horizon_days integer,
  expected_direction text,
  actual_change_pct numeric,
  is_correct boolean,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_validations_item ON public.checkup_knowledge_validations(knowledge_item_id);
CREATE INDEX IF NOT EXISTS idx_kb_validations_evaluated_at ON public.checkup_knowledge_validations(evaluated_at DESC);

ALTER TABLE public.checkup_knowledge_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view knowledge validations"
  ON public.checkup_knowledge_validations
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Admins manage knowledge validations"
  ON public.checkup_knowledge_validations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 4. 候選池 updated_at trigger
CREATE TRIGGER update_kb_candidates_updated_at
  BEFORE UPDATE ON public.checkup_knowledge_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();