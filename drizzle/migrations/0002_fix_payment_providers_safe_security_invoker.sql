-- SECURITY FIX: payment_providers_safe 是 SECURITY DEFINER view（繞過 RLS）。
-- 改法：把 env 遮罩成 generated column，view 改 security_invoker，
-- 並以「column-level GRANT + RLS policy」讓 anon/authenticated 只能看到
-- 非敏感欄位的 active provider；config 永遠不可讀。

ALTER TABLE public.payment_providers
  ADD COLUMN IF NOT EXISTS env text
  GENERATED ALWAYS AS (
    COALESCE(NULLIF(config ->> 'env', ''), NULLIF(config ->> 'mode', ''), 'production')
  ) STORED;

DROP VIEW IF EXISTS public.payment_providers_safe;
CREATE VIEW public.payment_providers_safe
WITH (security_invoker = on) AS
  SELECT id, provider_type, display_name, is_active, is_default, env, created_at
  FROM public.payment_providers
  WHERE is_active = true;

GRANT SELECT ON public.payment_providers_safe TO anon, authenticated;

-- 底層表：撤掉任何寬鬆授權，只開非敏感欄位
REVOKE ALL ON public.payment_providers FROM anon, authenticated;
GRANT SELECT (id, provider_type, display_name, is_active, is_default, env, created_at)
  ON public.payment_providers TO anon, authenticated;
GRANT ALL ON public.payment_providers TO service_role;

DROP POLICY IF EXISTS "Public can read active providers" ON public.payment_providers;
CREATE POLICY "Public can read active providers"
  ON public.payment_providers
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);
