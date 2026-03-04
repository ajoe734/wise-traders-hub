
-- Allow subscribers to view trade_records for their subscribed experts
CREATE POLICY "Subscribers can view subscribed expert trades"
  ON public.trade_records FOR SELECT
  TO authenticated
  USING (
    expert_id IN (
      SELECT has_active_subscription.expert_id
      FROM has_active_subscription(auth.uid()) has_active_subscription(plan_id, expert_id)
    )
  );
