-- Fix: payment_providers_safe was security_invoker=true, blocked by base table admin-only RLS
-- Rebuild as security_invoker=false so it runs with view owner privileges, bypassing base RLS.
-- Only exposes non-sensitive columns (no `config`) and only active providers.

DROP VIEW IF EXISTS public.payment_providers_safe;

CREATE VIEW public.payment_providers_safe
WITH (security_invoker = false) AS
SELECT
  id,
  provider_type,
  display_name,
  is_active,
  is_default,
  COALESCE(NULLIF(config->>'env',''), NULLIF(config->>'mode',''), 'production') AS env,
  created_at
FROM public.payment_providers
WHERE is_active = true;

GRANT SELECT ON public.payment_providers_safe TO anon, authenticated;
