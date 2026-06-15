
ALTER TABLE public.member_subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';

ALTER TABLE public.member_subscriptions
  ADD CONSTRAINT member_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'yearly'));
