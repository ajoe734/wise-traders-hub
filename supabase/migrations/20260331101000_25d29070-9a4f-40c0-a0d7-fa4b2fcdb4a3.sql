
CREATE TABLE public.checkup_knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('chip_analysis', 'technical_analysis', 'industry_trends', 'news_correlation', 'strategy_cases')),
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  fact TEXT NOT NULL,
  interpretation TEXT,
  action TEXT,
  lessons TEXT,
  return_pct NUMERIC,
  outcome TEXT,
  confidence NUMERIC DEFAULT 0.75,
  tags TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category, item_id)
);

ALTER TABLE public.checkup_knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read knowledge items"
  ON public.checkup_knowledge_items
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Authenticated users can manage knowledge items"
  ON public.checkup_knowledge_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
