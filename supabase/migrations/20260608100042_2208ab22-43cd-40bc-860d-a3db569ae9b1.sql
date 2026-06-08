
-- W4-1/W4-2: payment_intents 加狀態欄位
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payment_intents_status_created
  ON public.payment_intents(status, created_at);

-- W4-1: notification_preferences 加 renewal_email
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS renewal_email boolean NOT NULL DEFAULT true;

-- W4-4: paywall_events 表
CREATE TABLE IF NOT EXISTS public.paywall_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  visitor_id text,
  event_kind text NOT NULL CHECK (event_kind IN ('view', 'hit_limit', 'click_upgrade', 'dismiss')),
  surface text NOT NULL,
  variant text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.paywall_events TO authenticated;
GRANT INSERT ON public.paywall_events TO anon;
GRANT ALL ON public.paywall_events TO service_role;

ALTER TABLE public.paywall_events ENABLE ROW LEVEL SECURITY;

-- 任何人（含訪客）可寫入埋點
CREATE POLICY "Anyone can insert paywall events"
  ON public.paywall_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 僅 company_admin 可讀
CREATE POLICY "Company admin can read paywall events"
  ON public.paywall_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_paywall_events_surface_created
  ON public.paywall_events(surface, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paywall_events_variant_kind
  ON public.paywall_events(variant, event_kind);
CREATE INDEX IF NOT EXISTS idx_paywall_events_user
  ON public.paywall_events(user_id) WHERE user_id IS NOT NULL;
