-- Revoke EXECUTE on RLS helper is_tester(uuid) from anon.
-- 這個 SECURITY DEFINER 函式只有登入者需要（RLS policy 才會呼叫），
-- 對 anon 開放違反 1.35-F 的憲法：RLS helper 只允許 authenticated / service_role。
REVOKE ALL ON FUNCTION public.is_tester(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tester(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tester(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tester(uuid) TO service_role;