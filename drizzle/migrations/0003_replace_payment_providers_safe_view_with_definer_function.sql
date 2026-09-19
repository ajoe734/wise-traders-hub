-- 取代上一版方案：不讓 anon/authenticated 直接碰底層表（避免 config 授權面擴大），
-- 改以「只回傳非敏感欄位」的 SECURITY DEFINER 函式取代 SECURITY DEFINER view。

DROP POLICY IF EXISTS "Public can read active providers" ON public.payment_providers;
REVOKE ALL ON public.payment_providers FROM anon;
REVOKE ALL ON public.payment_providers FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_providers TO authenticated;
GRANT ALL ON public.payment_providers TO service_role;

DROP VIEW IF EXISTS public.payment_providers_safe;

CREATE OR REPLACE FUNCTION public.payment_providers_safe_list()
RETURNS TABLE (
  id uuid,
  provider_type public.provider_type,
  display_name text,
  is_active boolean,
  is_default boolean,
  env text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.provider_type, p.display_name, p.is_active, p.is_default, p.env, p.created_at
  FROM public.payment_providers p
  WHERE p.is_active = true
$$;

REVOKE ALL ON FUNCTION public.payment_providers_safe_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_providers_safe_list() TO anon, authenticated, service_role;
