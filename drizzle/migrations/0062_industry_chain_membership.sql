CREATE TABLE public.industry_chain_membership (
  symbol text NOT NULL,
  name text,
  chain text NOT NULL,
  chain_code text NOT NULL,
  sub_code text NOT NULL,
  sub_item text NOT NULL,
  tier text,
  source_url text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, sub_code)
);
GRANT SELECT ON public.industry_chain_membership TO authenticated;
GRANT ALL ON public.industry_chain_membership TO service_role;
ALTER TABLE public.industry_chain_membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read chain membership" ON public.industry_chain_membership
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));
COMMENT ON TABLE public.industry_chain_membership IS 'TPEx 產業價值鏈資訊平台成員（已取得授權），分類依據來源';