
-- Enable RLS on current_prices
ALTER TABLE public.current_prices ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read prices
CREATE POLICY "Authenticated users can view prices"
  ON public.current_prices FOR SELECT TO authenticated
  USING (true);

-- Allow anon to read as well (public market data)
CREATE POLICY "Anon users can view prices"
  ON public.current_prices FOR SELECT TO anon
  USING (true);
