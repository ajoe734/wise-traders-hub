
-- Drop and recreate the policy to exclude suspended experts for testers too
DROP POLICY IF EXISTS "Anyone can view active experts" ON public.experts;

CREATE POLICY "Anyone can view active experts"
ON public.experts
FOR SELECT
TO public
USING (
  (status = 'active'::text)
  OR (status = 'draft'::text AND is_tester(auth.uid()))
);
