ALTER TABLE public.stock_industry_map
  ADD COLUMN IF NOT EXISTS business_desc text,
  ADD COLUMN IF NOT EXISTS business_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence text,
  ADD COLUMN IF NOT EXISTS chain_tier text;
COMMENT ON COLUMN public.stock_industry_map.business_desc IS '公開資訊觀測站「主要經營業務」原文，分類依據來源';
COMMENT ON COLUMN public.stock_industry_map.evidence IS '分類依據說明；無依據且未人工確認者前台不採用';
COMMENT ON COLUMN public.stock_industry_map.chain_tier IS '主細分產業的產業鏈位置：上游/中游/下游/服務';