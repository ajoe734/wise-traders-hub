REVOKE EXECUTE ON FUNCTION public.cleanup_line_oauth_states() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_line_oauth_states() TO service_role;