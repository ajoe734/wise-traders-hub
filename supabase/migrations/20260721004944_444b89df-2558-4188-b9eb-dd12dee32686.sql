
-- 1) checkup_prediction_accuracy: 收斂 SELECT policy
DROP POLICY IF EXISTS "Authenticated users can read prediction accuracy" ON public.checkup_prediction_accuracy;
CREATE POLICY "Users read own prediction accuracy"
  ON public.checkup_prediction_accuracy FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'company_admin'::app_role));

-- 2) payment_providers_safe: 改為 security_invoker，並允許結帳流程讀取底表非敏感欄位
ALTER VIEW public.payment_providers_safe SET (security_invoker = true);

-- 底表新增 SELECT policy：任何人可讀 active provider
DROP POLICY IF EXISTS "Public can read active providers" ON public.payment_providers;
CREATE POLICY "Public can read active providers"
  ON public.payment_providers FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- 敏感 config 欄位撤銷 anon/authenticated 讀取權限（僅 service_role / company_admin 可讀）
REVOKE SELECT (config) ON public.payment_providers FROM anon, authenticated;

-- 3) signal_in_subscription_window: 加上 search_path
ALTER FUNCTION public.signal_in_subscription_window(expert_role, timestamptz, timestamptz, timestamptz)
  SET search_path = public;
