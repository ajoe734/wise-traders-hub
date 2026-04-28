-- Stage 3: payment_intents to bridge attribution/discount from create-order to callback
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_no text NOT NULL UNIQUE,
  user_id uuid,
  product_kind text NOT NULL DEFAULT 'expert_plan',
  plan_id uuid,
  checkup_plan_id uuid,
  expert_id uuid,
  billing_cycle text NOT NULL,
  original_amount integer NOT NULL,
  discount_amount integer NOT NULL DEFAULT 0,
  discount_reason text,
  amount integer NOT NULL,
  attribution jsonb,
  upgrade_from_subscription_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access payment_intents" ON public.payment_intents
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Users insert own intents" ON public.payment_intents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users view own intents" ON public.payment_intents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_payment_intents_trade_no ON public.payment_intents(trade_no);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON public.payment_intents(user_id);