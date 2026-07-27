-- Allow anon to read active payment providers via safe view (checkout page requirement).
-- Safe view already strips sensitive `config` field; base policy further restricts anon to active rows only.
CREATE POLICY "Anon can read active providers"
  ON public.payment_providers
  FOR SELECT
  TO anon
  USING (is_active = true);

GRANT SELECT ON public.payment_providers TO anon;
GRANT SELECT ON public.payment_providers_safe TO anon;
GRANT SELECT ON public.payment_providers_safe TO authenticated;