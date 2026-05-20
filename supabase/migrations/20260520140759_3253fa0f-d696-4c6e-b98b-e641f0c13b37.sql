-- Recreate safe view with env exposed
DROP VIEW IF EXISTS public.payment_providers_safe;
CREATE VIEW public.payment_providers_safe
WITH (security_invoker = true) AS
SELECT
  id,
  provider_type,
  display_name,
  is_active,
  is_default,
  COALESCE(NULLIF(config->>'env', ''), NULLIF(config->>'mode', ''), 'production') AS env,
  created_at
FROM public.payment_providers;

-- Sync ECPay provider config.env with payment_settings.ecpay_credentials (which is "production")
UPDATE public.payment_providers
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{env}', '"production"')
WHERE provider_type = 'ecpay';