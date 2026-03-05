CREATE POLICY "Analysts can view subscriber profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  user_id IN (
    SELECT ms.user_id
    FROM public.member_subscriptions ms
    JOIN public.expert_plans ep ON ep.id = ms.plan_id
    JOIN public.experts e ON e.id = ep.expert_id
    WHERE e.user_id = auth.uid()
  )
);