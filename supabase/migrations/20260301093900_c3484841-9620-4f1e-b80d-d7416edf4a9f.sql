-- Allow users to create their own subscriptions
CREATE POLICY "Users can insert own subscriptions"
ON public.member_subscriptions
FOR INSERT
WITH CHECK (user_id = auth.uid());
