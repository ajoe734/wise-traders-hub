-- Allow users to update their own subscriptions (for cancel)
CREATE POLICY "Users can update own subscriptions"
ON public.member_subscriptions
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());