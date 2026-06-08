-- R3 漏 GRANT 修補：前端 useExpertPerformance hook 直接呼叫此 RPC
-- 內部只讀 experts / trade_records / current_prices（皆已 RLS 公開可讀），
-- 因此補回 anon 與 authenticated 的 EXECUTE 權限
GRANT EXECUTE ON FUNCTION public.calculate_expert_performance(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.calculate_expert_performance(uuid) TO authenticated;