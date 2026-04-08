
-- Fix: Add INSERT and UPDATE RLS policies for user_performances
CREATE POLICY "Users can insert own user performances"
ON public.user_performances
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own user performances"
ON public.user_performances
FOR UPDATE
TO authenticated
USING (user_id = auth.uid());
