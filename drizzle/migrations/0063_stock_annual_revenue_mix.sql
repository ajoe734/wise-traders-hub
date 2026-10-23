CREATE TABLE public.stock_annual_revenue_mix (
  symbol text PRIMARY KEY,
  report_file text,
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  revenue_mix jsonb NOT NULL DEFAULT '[]'::jsonb,
  unmapped jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_pct numeric,
  status text NOT NULL,
  reason text,
  source_url text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.stock_annual_revenue_mix IS '股東會年報營業比重（官方電子書），供多角化主業權重；revenue_mix 僅含完全對照字典的產品';
GRANT SELECT ON public.stock_annual_revenue_mix TO authenticated;
GRANT ALL ON public.stock_annual_revenue_mix TO service_role;
ALTER TABLE public.stock_annual_revenue_mix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read annual revenue mix" ON public.stock_annual_revenue_mix FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));