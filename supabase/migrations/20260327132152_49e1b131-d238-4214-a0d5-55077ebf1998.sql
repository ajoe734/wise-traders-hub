CREATE POLICY "Analysts can view own user performances"
ON public.user_performances
FOR SELECT
TO authenticated
USING (user_id = auth.uid());