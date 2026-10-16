-- tw_sales_basis 只有 valuation-ps-sync（service_role，BYPASSRLS）會讀寫；
-- 前端與任何 database function 都不讀它，因此不需要公開讀取。
-- 移除「任何人可讀全表」政策，並收回 anon/authenticated 的所有權限，
-- 讓一般訪客與會員無法再直接讀取每股營收母數表。
DROP POLICY IF EXISTS "sales basis public read" ON public.tw_sales_basis;
REVOKE ALL ON public.tw_sales_basis FROM anon;
REVOKE ALL ON public.tw_sales_basis FROM authenticated;
GRANT ALL ON public.tw_sales_basis TO service_role;
COMMENT ON TABLE public.tw_sales_basis IS '每股營收母數（站牌 PS 分母）。僅供 valuation-ps-sync 經 service_role 讀寫；一般會員不直接讀取，故無公開讀取政策。';