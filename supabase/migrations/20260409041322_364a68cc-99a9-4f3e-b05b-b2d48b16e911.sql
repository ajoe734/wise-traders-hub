
-- Create a SECURITY DEFINER function to check is_tester without triggering RLS on profiles
CREATE OR REPLACE FUNCTION public.is_tester(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_tester FROM public.profiles WHERE user_id = _user_id LIMIT 1),
    false
  )
$$;

-- Fix experts policy to use the new function instead of subquery on profiles
DROP POLICY IF EXISTS "Anyone can view active experts" ON public.experts;
CREATE POLICY "Anyone can view active experts"
  ON public.experts FOR SELECT
  USING (
    status = 'active'
    OR public.is_tester(auth.uid())
  );

-- Fix trade_records policy similarly
DROP POLICY IF EXISTS "Anyone can view closed trades for active experts" ON public.trade_records;
CREATE POLICY "Anyone can view closed trades for active experts"
  ON public.trade_records FOR SELECT
  USING (
    (status IN ('closed', 'stopped'))
    AND (
      expert_id IN (SELECT id FROM public.experts WHERE status = 'active')
      OR public.is_tester(auth.uid())
    )
  );
