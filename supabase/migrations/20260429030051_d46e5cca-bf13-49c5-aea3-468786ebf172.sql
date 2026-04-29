-- 1. 修 revenue_splits.rule_source CHECK
ALTER TABLE public.revenue_splits DROP CONSTRAINT IF EXISTS revenue_splits_rule_source_check;
ALTER TABLE public.revenue_splits ADD CONSTRAINT revenue_splits_rule_source_check
  CHECK (rule_source IN (
    'expert_override','channel_override',
    'attributed_default','standard_default','checkup_default',
    -- 保留舊值以容納可能的歷史資料（若有）
    'channel','expert','default','checkup'
  ));

-- 2. 統一 payment_settings 新鍵（從舊鍵搬移；若舊鍵不存在則寫預設）
INSERT INTO public.payment_settings (key, value)
SELECT 'split_standard',
  COALESCE(
    (SELECT jsonb_build_object(
       'pct_platform', COALESCE((value->>'platform')::int, 55),
       'pct_expert',   COALESCE((value->>'expert')::int, 45),
       'pct_channel',  COALESCE((value->>'channel')::int, 0)
     ) FROM public.payment_settings WHERE key = 'split_default_no_referral'),
    '{"pct_platform":55,"pct_expert":45,"pct_channel":0}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.payment_settings (key, value)
SELECT 'split_attributed',
  COALESCE(
    (SELECT jsonb_build_object(
       'pct_platform', COALESCE((value->>'platform')::int, 35),
       'pct_expert',   COALESCE((value->>'expert')::int, 45),
       'pct_channel',  COALESCE((value->>'channel')::int, 20)
     ) FROM public.payment_settings WHERE key = 'split_default_with_referral'),
    '{"pct_platform":35,"pct_expert":45,"pct_channel":20}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.payment_settings (key, value)
SELECT 'split_checkup',
  COALESCE(
    (SELECT jsonb_build_object(
       'pct_platform', COALESCE((value->>'platform')::int, 100),
       'pct_expert',   COALESCE((value->>'expert')::int, 0),
       'pct_channel',  COALESCE((value->>'channel')::int, 0)
     ) FROM public.payment_settings WHERE key = 'split_default_checkup'),
    '{"pct_platform":100,"pct_expert":0,"pct_channel":0}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

-- 3. 跨產品折扣鍵
INSERT INTO public.payment_settings (key, value)
SELECT 'cross_discounts',
  COALESCE(
    (SELECT jsonb_build_object(
       'has_checkup_basic_discount_on_expert', COALESCE((value->>'basic_then_expert')::int, 100),
       'has_checkup_pro_discount_on_expert',   COALESCE((value->>'pro_then_expert')::int, 200),
       'has_expert_discount_on_checkup_basic', COALESCE((value->>'expert_then_basic')::int, 100),
       'has_expert_discount_on_checkup_pro',   COALESCE((value->>'expert_then_pro')::int, 200)
     ) FROM public.payment_settings WHERE key = 'cross_discount_rules'),
    '{"has_checkup_basic_discount_on_expert":100,"has_checkup_pro_discount_on_expert":200,"has_expert_discount_on_checkup_basic":100,"has_expert_discount_on_checkup_pro":200}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

-- 4. remittance_account 欄位統一（轉舊欄位 bank/branch/name/account → bank_name/.../account_number/account_name）
UPDATE public.payment_settings
SET value = jsonb_build_object(
  'bank_name',      COALESCE(value->>'bank_name',      value->>'bank',    ''),
  'bank_code',      COALESCE(value->>'bank_code',      value->>'branch',  ''),
  'account_number', COALESCE(value->>'account_number', value->>'account', ''),
  'account_name',   COALESCE(value->>'account_name',   value->>'name',    '')
)
WHERE key = 'remittance_account';

-- 5. 確保 referral_channels.source 比對一致（lowercase trigger）
CREATE OR REPLACE FUNCTION public.lowercase_referral_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.source := lower(trim(NEW.source));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_channels_lowercase ON public.referral_channels;
CREATE TRIGGER trg_referral_channels_lowercase
  BEFORE INSERT OR UPDATE ON public.referral_channels
  FOR EACH ROW EXECUTE FUNCTION public.lowercase_referral_source();