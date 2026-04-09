
-- Add is_tester flag to profiles
ALTER TABLE public.profiles ADD COLUMN is_tester boolean NOT NULL DEFAULT false;

-- Drop and recreate the "Anyone can view active experts" policy to include testers
DROP POLICY IF EXISTS "Anyone can view active experts" ON public.experts;
CREATE POLICY "Anyone can view active experts"
  ON public.experts FOR SELECT
  USING (
    status = 'active'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = auth.uid() AND profiles.is_tester = true
    )
  );

-- Update trade_records policy so testers can see draft expert trades too
DROP POLICY IF EXISTS "Anyone can view closed trades for active experts" ON public.trade_records;
CREATE POLICY "Anyone can view closed trades for active experts"
  ON public.trade_records FOR SELECT
  USING (
    (status IN ('closed', 'stopped'))
    AND (
      expert_id IN (SELECT id FROM public.experts WHERE status = 'active')
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.user_id = auth.uid() AND profiles.is_tester = true
      )
    )
  );
