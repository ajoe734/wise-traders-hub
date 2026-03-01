-- Allow authenticated users to view active payment providers (needed for checkout)
CREATE POLICY "Authenticated users can view active providers"
ON public.payment_providers
FOR SELECT
USING (is_active = true AND auth.uid() IS NOT NULL);
