GRANT SELECT ON public.tw_sales_basis TO authenticated;
GRANT ALL ON public.tw_sales_basis TO service_role;
ALTER TABLE public.tw_sales_basis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tw_sales_basis_authenticated_read" ON public.tw_sales_basis;
CREATE POLICY "tw_sales_basis_authenticated_read" ON public.tw_sales_basis FOR SELECT TO authenticated USING (true);