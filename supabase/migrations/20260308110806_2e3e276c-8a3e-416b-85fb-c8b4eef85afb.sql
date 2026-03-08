
-- Enable RLS on existing trade_signals
ALTER TABLE public.trade_signals ENABLE ROW LEVEL SECURITY;

-- Analysts can insert own records
CREATE POLICY "Analysts can insert own trade_signals"
  ON public.trade_signals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Analysts can view own records
CREATE POLICY "Analysts can view own trade_signals"
  ON public.trade_signals FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Analysts can update own records
CREATE POLICY "Analysts can update own trade_signals"
  ON public.trade_signals FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Company admins full access
CREATE POLICY "Company admins full access trade_signals"
  ON public.trade_signals FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));
