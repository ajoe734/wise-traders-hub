
-- ============================================================
-- Stage 1: 健檢獨立商品 + 渠道追蹤 + 可調分潤 + 匯款 schema
-- ============================================================

-- 1. 擴充 plan_type enum（健檢兩級）
ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'checkup_basic';
ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'checkup_pro';

-- 2. payment_settings：系統預設分潤 + 收款帳號
CREATE TABLE IF NOT EXISTS public.payment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access payment_settings"
  ON public.payment_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Anyone can read remittance account"
  ON public.payment_settings FOR SELECT TO authenticated
  USING (key = 'remittance_account');

-- Seed 預設值
INSERT INTO public.payment_settings (key, value) VALUES
  ('split_default_no_referral',   '{"platform":55,"expert":45,"channel":0}'::jsonb),
  ('split_default_with_referral', '{"platform":35,"expert":45,"channel":20}'::jsonb),
  ('split_default_checkup',       '{"platform":100,"expert":0,"channel":0}'::jsonb),
  ('remittance_account',          '{"bank":"","branch":"","name":"","account":""}'::jsonb),
  ('cross_discount_rules',        '{"expert_then_basic":100,"expert_then_pro":200,"basic_then_expert":100,"pro_then_expert":200}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. referral_channels：渠道主檔 + 個別覆寫
CREATE TABLE IF NOT EXISTS public.referral_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text UNIQUE NOT NULL,
  display_name text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  pct_platform int,
  pct_expert int,
  pct_channel int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_channels_pct_valid CHECK (
    (pct_platform IS NULL AND pct_expert IS NULL AND pct_channel IS NULL)
    OR (pct_platform + pct_expert + pct_channel = 100)
  )
);
ALTER TABLE public.referral_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access referral_channels"
  ON public.referral_channels FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));

-- 4. referral_attributions：使用者歸因（先到先得 30 天鎖）
CREATE TABLE IF NOT EXISTS public.referral_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  visitor_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  ref_code text,
  landing_path text,
  locked_until timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ref_attr_user ON public.referral_attributions(user_id);
CREATE INDEX IF NOT EXISTS idx_ref_attr_visitor ON public.referral_attributions(visitor_id);
ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own attribution"
  ON public.referral_attributions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users view own attribution"
  ON public.referral_attributions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins full access attributions"
  ON public.referral_attributions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));

-- 5. remittance_orders：匯款待對帳
CREATE TABLE IF NOT EXISTS public.remittance_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  amount int NOT NULL,
  original_amount int,
  discount_amount int NOT NULL DEFAULT 0,
  discount_reason text,
  last5 text NOT NULL,
  payer_name text NOT NULL,
  attribution jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','expired')),
  reject_reason text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  subscription_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_remittance_user ON public.remittance_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_remittance_status ON public.remittance_orders(status);
ALTER TABLE public.remittance_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own remittance"
  ON public.remittance_orders FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users view own remittance"
  ON public.remittance_orders FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins full access remittance"
  ON public.remittance_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));

-- 6. revenue_splits：每筆交易拆分快照（不回溯）
CREATE TABLE IF NOT EXISTS public.revenue_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  expert_id uuid,
  plan_id uuid,
  gross int NOT NULL,
  discount int NOT NULL DEFAULT 0,
  discount_source text,
  net int NOT NULL,
  platform_amount int NOT NULL,
  expert_amount int NOT NULL DEFAULT 0,
  channel_reserve int NOT NULL DEFAULT 0,
  rule_source text NOT NULL CHECK (rule_source IN ('channel','expert','default','checkup')),
  rule_snapshot jsonb NOT NULL,
  utm_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_splits_tx ON public.revenue_splits(transaction_id);
CREATE INDEX IF NOT EXISTS idx_splits_expert ON public.revenue_splits(expert_id);
ALTER TABLE public.revenue_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access splits"
  ON public.revenue_splits FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Experts view own splits"
  ON public.revenue_splits FOR SELECT TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

-- 7. experts 加分潤覆寫
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS split_no_ref jsonb,
  ADD COLUMN IF NOT EXISTS split_with_ref jsonb;

-- 8. payment_transactions 加 attribution + 折扣紀錄
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS attribution jsonb,
  ADD COLUMN IF NOT EXISTS original_amount int,
  ADD COLUMN IF NOT EXISTS discount_amount int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text;

-- 9. updated_at trigger
CREATE TRIGGER update_payment_settings_updated_at
  BEFORE UPDATE ON public.payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_referral_channels_updated_at
  BEFORE UPDATE ON public.referral_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
