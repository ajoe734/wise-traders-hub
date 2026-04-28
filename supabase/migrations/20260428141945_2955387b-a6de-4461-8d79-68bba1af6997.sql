-- 持股健檢獨立商品（平台自營，不綁 expert）
CREATE TABLE public.checkup_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL UNIQUE,                 -- 'basic' | 'pro'
  name text NOT NULL,
  description text,
  price_monthly integer NOT NULL,
  price_yearly integer NOT NULL,
  monthly_quota integer NOT NULL,            -- 月用量上限（軟上限，UI 顯示用）
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.checkup_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active checkup plans"
  ON public.checkup_plans FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins full access checkup plans"
  ON public.checkup_plans FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

CREATE TRIGGER trg_checkup_plans_updated_at
  BEFORE UPDATE ON public.checkup_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 健檢訂閱（與 member_subscriptions 完全分離）
CREATE TABLE public.checkup_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.checkup_plans(id),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  status subscription_status NOT NULL DEFAULT 'active',
  auto_renew boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  canceled_at timestamptz,
  provider_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkup_subs_user ON public.checkup_subscriptions(user_id, status);

ALTER TABLE public.checkup_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own checkup subs"
  ON public.checkup_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update own checkup sub prefs"
  ON public.checkup_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins full access checkup subs"
  ON public.checkup_subscriptions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 健檢用量計數（每月配額，pro 22、basic 4，軟上限不擋）
CREATE TABLE public.checkup_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'analysis'
);
CREATE INDEX idx_checkup_usage_user_time ON public.checkup_usage(user_id, used_at DESC);

ALTER TABLE public.checkup_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own checkup usage"
  ON public.checkup_usage FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own checkup usage"
  ON public.checkup_usage FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins full access checkup usage"
  ON public.checkup_usage FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 種子：基礎 / 進階
INSERT INTO public.checkup_plans (tier, name, description, price_monthly, price_yearly, monthly_quota, features, sort_order)
VALUES
  ('basic', '持股健檢 · 基礎', '輕量使用者：每月 4 次健檢分析', 699, 6990, 4,
   '["每月 4 次 AI 健檢","個股事件預測","知識庫查詢"]'::jsonb, 1),
  ('pro',   '持股健檢 · 進階', '每天都用：每月 22 次健檢分析', 1299, 12990, 22,
   '["每月 22 次 AI 健檢","個股事件預測","知識庫查詢","盤後深度報告","優先 AI 排程"]'::jsonb, 2);

-- remittance_orders 支援健檢（plan 可能來自 checkup_plans 或 expert_plans）
ALTER TABLE public.remittance_orders
  ADD COLUMN IF NOT EXISTS product_kind text NOT NULL DEFAULT 'expert_plan',
  ADD COLUMN IF NOT EXISTS checkup_plan_id uuid REFERENCES public.checkup_plans(id),
  ALTER COLUMN plan_id DROP NOT NULL;

ALTER TABLE public.remittance_orders
  ADD CONSTRAINT remittance_product_consistency
  CHECK (
    (product_kind = 'expert_plan' AND plan_id IS NOT NULL AND checkup_plan_id IS NULL) OR
    (product_kind = 'checkup_plan' AND checkup_plan_id IS NOT NULL AND plan_id IS NULL)
  );