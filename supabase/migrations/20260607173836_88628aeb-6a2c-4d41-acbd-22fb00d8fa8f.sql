
-- S8-01: 補上 search_path
CREATE OR REPLACE FUNCTION public.touch_checkup_entitlements_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

-- S8-02: 收斂 SECURITY DEFINER 函式對 anon/PUBLIC 的執行權限
-- 這些是 RLS / 應用層的「已登入使用者」檢查函式，匿名請求不該執行
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_active_subscription_after(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription_after(uuid, timestamptz) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_subscribed_to_plan(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_subscribed_to_plan(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_tester(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tester(uuid) TO authenticated, service_role;

-- 註：以下保留 PUBLIC 執行（landing/pricing 公開頁面需要）
--   get_expert_detail_bundle / get_pricing_bundle / get_public_experts_list
-- 註：pg_trgm 仍在 public schema —— 既有索引/相似度查詢依賴，搬遷會破壞索引，
--    保留不動，待之後安排專屬維護視窗再處理（migration 註解為證）。
