-- Revert direct anon access to base table (config field must not leak).
DROP POLICY IF EXISTS "Anon can read active providers" ON public.payment_providers;
REVOKE SELECT ON public.payment_providers FROM anon;

-- Recreate safe view WITHOUT security_invoker so it can bypass base RLS while only exposing safe columns.
DROP VIEW IF EXISTS public.payment_providers_safe;
CREATE VIEW public.payment_providers_safe AS
  SELECT
    id,
    provider_type,
    display_name,
    is_active,
    is_default,
    COALESCE(NULLIF(config ->> 'env', ''), NULLIF(config ->> 'mode', ''), 'production') AS env,
    created_at
  FROM public.payment_providers
  WHERE is_active = true;

GRANT SELECT ON public.payment_providers_safe TO anon;
GRANT SELECT ON public.payment_providers_safe TO authenticated;