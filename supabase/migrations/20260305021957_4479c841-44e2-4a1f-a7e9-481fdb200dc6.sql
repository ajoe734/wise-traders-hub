
-- Recreate the view with security_invoker = false so all users can read public LINE channel info
DROP VIEW IF EXISTS public.expert_line_channels_public;

CREATE VIEW public.expert_line_channels_public
WITH (security_invoker = false)
AS
SELECT
  id,
  expert_id,
  channel_id,
  channel_name,
  line_oa_id,
  qr_code_url,
  is_active,
  created_at,
  updated_at
FROM public.expert_line_channels;

-- Grant SELECT to authenticated and anon roles
GRANT SELECT ON public.expert_line_channels_public TO authenticated;
GRANT SELECT ON public.expert_line_channels_public TO anon;
