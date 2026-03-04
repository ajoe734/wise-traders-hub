
-- Remove the policy that allows owning analyst to view line channels
DROP POLICY IF EXISTS "Admins and owning analyst can view line channels" ON public.expert_line_channels;

-- Create strict admin-only SELECT policy
CREATE POLICY "Only admins can view line channels"
  ON public.expert_line_channels FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));
