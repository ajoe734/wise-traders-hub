
-- ==========================================
-- Enum Types
-- ==========================================
CREATE TYPE public.expert_role AS ENUM ('advisor', 'mentor');
CREATE TYPE public.plan_type AS ENUM ('analyst_signal_l1', 'analyst_signal_diag_l2', 'mentor_weekly_journal');
CREATE TYPE public.review_status AS ENUM ('draft', 'pending', 'approved', 'rejected');
CREATE TYPE public.signal_action AS ENUM ('buy', 'sell', 'add', 'trim', 'exit');
CREATE TYPE public.signal_status AS ENUM ('published', 'taken_down');
CREATE TYPE public.trade_status AS ENUM ('open', 'closed', 'stopped');
CREATE TYPE public.subscription_status AS ENUM ('active', 'canceled', 'expired');
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE public.provider_type AS ENUM ('ecpay', 'newebpay', 'stripe', 'line_pay');

-- ==========================================
-- 1. experts
-- ==========================================
CREATE TABLE public.experts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  role expert_role NOT NULL,
  bio text,
  description text,
  style_tags text[],
  markets text[],
  avatar_url text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.experts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can view own expert" ON public.experts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Analysts can update own expert" ON public.experts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Company admins full access experts" ON public.experts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

-- ==========================================
-- 2. expert_plans
-- ==========================================
CREATE TABLE public.expert_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  plan_type plan_type NOT NULL,
  price_monthly integer NOT NULL DEFAULT 0,
  price_yearly integer,
  features jsonb DEFAULT '[]'::jsonb,
  review_status review_status NOT NULL DEFAULT 'draft',
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can view own plans" ON public.expert_plans
  FOR SELECT TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

CREATE POLICY "Analysts can insert own plans" ON public.expert_plans
  FOR INSERT TO authenticated
  WITH CHECK (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

CREATE POLICY "Analysts can update own plans" ON public.expert_plans
  FOR UPDATE TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

CREATE POLICY "Company admins full access plans" ON public.expert_plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

-- ==========================================
-- 3. expert_signals
-- ==========================================
CREATE TABLE public.expert_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.expert_plans(id),
  instrument text NOT NULL,
  action signal_action NOT NULL,
  price_hint numeric,
  reason_summary text,
  reason_detail text,
  risk_notes text,
  learning_points text,
  status signal_status NOT NULL DEFAULT 'published',
  taken_down_reason text,
  taken_down_by uuid,
  published_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can view own signals" ON public.expert_signals
  FOR SELECT TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

CREATE POLICY "Analysts can insert own signals" ON public.expert_signals
  FOR INSERT TO authenticated
  WITH CHECK (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

CREATE POLICY "Analysts can update own signals" ON public.expert_signals
  FOR UPDATE TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

CREATE POLICY "Company admins full access signals" ON public.expert_signals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

-- ==========================================
-- 4. trade_records (read-only, system-generated)
-- ==========================================
CREATE TABLE public.trade_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.expert_signals(id),
  instrument text NOT NULL,
  entry_price numeric,
  exit_price numeric,
  entry_date timestamptz,
  exit_date timestamptz,
  pnl_percent numeric,
  status trade_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trade_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can view own trades" ON public.trade_records
  FOR SELECT TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

CREATE POLICY "Company admins can view all trades" ON public.trade_records
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

-- ==========================================
-- 5. member_subscriptions
-- ==========================================
CREATE TABLE public.member_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.expert_plans(id) ON DELETE CASCADE,
  status subscription_status NOT NULL DEFAULT 'active',
  auto_renew boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  canceled_at timestamptz,
  provider_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can view own plan subscriptions" ON public.member_subscriptions
  FOR SELECT TO authenticated
  USING (plan_id IN (
    SELECT ep.id FROM public.expert_plans ep
    JOIN public.experts e ON ep.expert_id = e.id
    WHERE e.user_id = auth.uid()
  ));

CREATE POLICY "Company admins full access subscriptions" ON public.member_subscriptions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Users can view own subscriptions" ON public.member_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ==========================================
-- 6. payment_providers
-- ==========================================
CREATE TABLE public.payment_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type provider_type NOT NULL,
  display_name text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins full access providers" ON public.payment_providers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

-- ==========================================
-- 7. payment_transactions
-- ==========================================
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.member_subscriptions(id),
  provider_id uuid REFERENCES public.payment_providers(id),
  amount integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'TWD',
  status payment_status NOT NULL DEFAULT 'pending',
  provider_tx_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can view all transactions" ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Company admins can update transactions" ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

-- Add FK for member_subscriptions.provider_id after payment_providers exists
ALTER TABLE public.member_subscriptions
  ADD CONSTRAINT fk_member_subscriptions_provider
  FOREIGN KEY (provider_id) REFERENCES public.payment_providers(id);

-- ==========================================
-- 8. audit_logs
-- ==========================================
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  detail jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "System can insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ==========================================
-- Trigger: Auto-generate trade_records from signals
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_signal_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' THEN
    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, NEW.published_at, 'open');
    ELSIF NEW.action IN ('sell', 'exit') THEN
      UPDATE public.trade_records
      SET exit_price = NEW.price_hint,
          exit_date = NEW.published_at,
          pnl_percent = CASE
            WHEN entry_price IS NOT NULL AND entry_price > 0
            THEN ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)
            ELSE NULL
          END,
          status = CASE WHEN NEW.action = 'exit' THEN 'stopped' ELSE 'closed' END
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_signal_published
  AFTER INSERT ON public.expert_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_signal_trade();

-- ==========================================
-- Function: Calculate expert performance
-- ==========================================
CREATE OR REPLACE FUNCTION public.calculate_expert_performance(_expert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  total_trades integer;
  winning_trades integer;
  total_pnl numeric;
  max_dd numeric;
  avg_hold numeric;
  profit_sum numeric;
  loss_sum numeric;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pnl_percent > 0),
    COALESCE(SUM(pnl_percent), 0),
    COALESCE(MIN(pnl_percent), 0),
    COALESCE(AVG(EXTRACT(EPOCH FROM (exit_date - entry_date)) / 86400), 0),
    COALESCE(SUM(pnl_percent) FILTER (WHERE pnl_percent > 0), 0),
    COALESCE(ABS(SUM(pnl_percent) FILTER (WHERE pnl_percent < 0)), 1)
  INTO total_trades, winning_trades, total_pnl, max_dd, avg_hold, profit_sum, loss_sum
  FROM public.trade_records
  WHERE expert_id = _expert_id
    AND status IN ('closed', 'stopped');

  result := jsonb_build_object(
    'total_trades', total_trades,
    'win_rate', CASE WHEN total_trades > 0 THEN ROUND((winning_trades::numeric / total_trades) * 100, 1) ELSE 0 END,
    'cumulative_return', ROUND(total_pnl, 2),
    'max_drawdown', ROUND(max_dd, 2),
    'profit_factor', CASE WHEN loss_sum > 0 THEN ROUND(profit_sum / loss_sum, 2) ELSE 0 END,
    'avg_hold_days', ROUND(avg_hold, 1),
    'total_pnl', ROUND(total_pnl, 2)
  );

  RETURN result;
END;
$$;
