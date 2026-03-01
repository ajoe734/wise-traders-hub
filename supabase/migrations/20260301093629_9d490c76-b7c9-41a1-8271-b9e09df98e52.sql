-- Allow public (authenticated) users to view all active experts
CREATE POLICY "Anyone can view active experts"
ON public.experts
FOR SELECT
USING (status = 'active');

-- Allow public (authenticated) users to view all active approved plans
CREATE POLICY "Anyone can view active approved plans"
ON public.expert_plans
FOR SELECT
USING (is_active = true AND review_status = 'approved');
