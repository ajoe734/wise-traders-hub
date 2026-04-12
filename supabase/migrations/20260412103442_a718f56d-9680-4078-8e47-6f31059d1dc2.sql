-- Fix ERROR: RLS Disabled on trade_signals and user_performances
ALTER TABLE public.trade_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_performances ENABLE ROW LEVEL SECURITY;

-- Fix ERROR: Security Definer Views - drop and recreate as SECURITY INVOKER
DROP VIEW IF EXISTS public.experts_public;
CREATE VIEW public.experts_public
WITH (security_invoker = true)
AS
SELECT id, name, slug, role, status, bio, description, avatar_url, markets, style_tags, created_at
FROM public.experts;

DROP VIEW IF EXISTS public.expert_line_channels_public;
CREATE VIEW public.expert_line_channels_public
WITH (security_invoker = true)
AS
SELECT id, expert_id, channel_id, channel_name, line_oa_id, qr_code_url, is_active, created_at, updated_at
FROM public.expert_line_channels;