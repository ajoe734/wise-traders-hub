
-- 1) expert_line_channels: restrict channel_access_token to admins & owning analyst only
DROP POLICY IF EXISTS "Authenticated users can view line channel public info" ON public.expert_line_channels;

CREATE POLICY "Admins and owning analyst can view line channels"
  ON public.expert_line_channels FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'company_admin'::app_role)
    OR expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid())
  );

-- Create a public view without the token for subscriber-facing queries
CREATE OR REPLACE VIEW public.expert_line_channels_public
WITH (security_invoker = on) AS
  SELECT id, expert_id, channel_id, channel_name, line_oa_id, qr_code_url, is_active, created_at, updated_at
  FROM public.expert_line_channels;

-- 2) experts: create a public view without user_id
CREATE OR REPLACE VIEW public.experts_public
WITH (security_invoker = on) AS
  SELECT id, name, slug, role, status, bio, description, avatar_url, markets, style_tags, created_at
  FROM public.experts;

-- 3) payment_transactions: let users view their own transactions via subscription link
CREATE POLICY "Users can view own transactions"
  ON public.payment_transactions FOR SELECT
  TO authenticated
  USING (
    subscription_id IN (
      SELECT id FROM public.member_subscriptions WHERE user_id = auth.uid()
    )
  );
