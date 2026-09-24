DROP POLICY IF EXISTS "authenticated read probe" ON public.tw_bsr_upstream_probe;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.tw_bsr_upstream_probe FROM anon, authenticated;
GRANT ALL ON public.tw_bsr_upstream_probe TO service_role;