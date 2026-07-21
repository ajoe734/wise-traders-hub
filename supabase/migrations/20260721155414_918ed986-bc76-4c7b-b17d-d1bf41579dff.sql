-- Remove public read policy on payment_providers to prevent config leak to anon/authenticated.
-- Frontend checkout should use public.payment_providers_safe view (already exposes non-sensitive columns).
DROP POLICY IF EXISTS "Public can read active providers" ON public.payment_providers;