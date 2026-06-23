-- 移除回退加上的公開讀取 policy（migration 20260414035210 把已 DROP 的規則加了回來）
-- 影響：任何 authenticated 使用者可讀整列含 config jsonb（merchant ID / API key 風險）
-- 結帳流程早已改用 payment_providers_safe 視圖，不依賴此 policy
DROP POLICY IF EXISTS "Anyone can view active providers" ON public.payment_providers;