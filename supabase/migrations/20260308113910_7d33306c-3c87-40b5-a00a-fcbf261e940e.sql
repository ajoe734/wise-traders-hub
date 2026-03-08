
-- Drop all RLS policies on trade_signals
DROP POLICY IF EXISTS "Analysts can insert own trade_signals" ON public.trade_signals;
DROP POLICY IF EXISTS "Analysts can update own trade_signals" ON public.trade_signals;
DROP POLICY IF EXISTS "Analysts can view own trade_signals" ON public.trade_signals;
DROP POLICY IF EXISTS "Company admins full access trade_signals" ON public.trade_signals;

-- Disable RLS
ALTER TABLE public.trade_signals DISABLE ROW LEVEL SECURITY;
