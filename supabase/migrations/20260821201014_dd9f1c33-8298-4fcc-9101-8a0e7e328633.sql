REVOKE EXECUTE ON FUNCTION public.sample_redact_m1(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.preview_expert_public_sample(uuid, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_expert_public_sample(uuid, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_expert_public_sample(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_expert_public_sample_status(uuid) FROM anon;