
-- 1. 新表 plan_split_overrides
CREATE TABLE public.plan_split_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.expert_plans(id) ON DELETE CASCADE,
  pct_platform int NOT NULL CHECK (pct_platform BETWEEN 0 AND 100),
  pct_expert int NOT NULL CHECK (pct_expert BETWEEN 0 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id),
  CHECK (pct_platform + pct_expert = 100)
);

ALTER TABLE public.plan_split_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access plan splits"
  ON public.plan_split_overrides FOR ALL TO authenticated
  USING (has_role(auth.uid(),'company_admin'))
  WITH CHECK (has_role(auth.uid(),'company_admin'));

CREATE POLICY "Experts view own plan splits"
  ON public.plan_split_overrides FOR SELECT TO authenticated
  USING (plan_id IN (
    SELECT ep.id FROM public.expert_plans ep
    JOIN public.experts e ON e.id = ep.expert_id
    WHERE e.user_id = auth.uid()
  ));

CREATE TRIGGER trg_plan_split_overrides_updated_at
  BEFORE UPDATE ON public.plan_split_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. 移轉舊資料：experts.split_no_ref → plan_split_overrides
INSERT INTO public.plan_split_overrides (plan_id, pct_platform, pct_expert, notes)
SELECT ep.id,
       COALESCE((e.split_no_ref->>'platform')::int, 55),
       COALESCE((e.split_no_ref->>'expert')::int, 45),
       'Migrated from experts.split_no_ref'
FROM public.expert_plans ep
JOIN public.experts e ON e.id = ep.expert_id
WHERE e.split_no_ref IS NOT NULL
  AND (e.split_no_ref->>'platform') IS NOT NULL
  AND (e.split_no_ref->>'expert') IS NOT NULL
  AND COALESCE((e.split_no_ref->>'platform')::int, 0) + COALESCE((e.split_no_ref->>'expert')::int, 0) = 100
ON CONFLICT (plan_id) DO NOTHING;

-- 3. DROP 舊欄位
ALTER TABLE public.experts DROP COLUMN IF EXISTS split_no_ref;
ALTER TABLE public.experts DROP COLUMN IF EXISTS split_with_ref;

-- 4. 清理 payment_settings 舊鍵
DELETE FROM public.payment_settings
WHERE key IN (
  'split_default_no_referral',
  'split_default_with_referral',
  'split_default_checkup',
  'cross_discount_rules',
  'split_attributed'
);

-- 5. 收斂 revenue_splits.rule_source CHECK
ALTER TABLE public.revenue_splits DROP CONSTRAINT IF EXISTS revenue_splits_rule_source_check;
ALTER TABLE public.revenue_splits ADD CONSTRAINT revenue_splits_rule_source_check
  CHECK (rule_source IN ('plan_override','standard_default','checkup_default'));
