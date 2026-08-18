-- =====================================================================
-- PV-E2E 002 — clone shape delta for the real-browser admin E2E stage.
-- Extends db/r1/c/PV/000_clone_shape.sql to the production COLUMN superset
-- (read read-only from information_schema on production, never data) so the
-- real app build can run its real queries against a real PostgREST.
-- All content inserted by the E2E stage is SYNTHETIC.
-- =====================================================================
SET client_min_messages = warning;

-- ---------------------------------------------------------------- enums
DO $$ BEGIN CREATE TYPE public.plan_type AS ENUM
  ('analyst_signal_l1','analyst_signal_diag_l2','mentor_weekly_journal','checkup_basic','checkup_pro');
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN CREATE TYPE public.plan_review_status AS ENUM ('draft','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN END $$;

-- ---------------------------------------------------------------- profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS expert_slug text,
  ADD COLUMN IF NOT EXISTS line_user_id text,
  ADD COLUMN IF NOT EXISTS is_line_friend boolean,
  ADD COLUMN IF NOT EXISTS merged_into_user_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'company_admin'::app_role));

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------- experts
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS style_tags text[],
  ADD COLUMN IF NOT EXISTS markets text[],
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS strategy_summary text,
  ADD COLUMN IF NOT EXISTS backtest_1y_return numeric,
  ADD COLUMN IF NOT EXISTS backtest_max_drawdown numeric,
  ADD COLUMN IF NOT EXISTS backtest_annual_return numeric,
  ADD COLUMN IF NOT EXISTS starting_capital integer,
  ADD COLUMN IF NOT EXISTS risk_preference text,
  ADD COLUMN IF NOT EXISTS operation_cycle text,
  ADD COLUMN IF NOT EXISTS strategy_name text,
  ADD COLUMN IF NOT EXISTS line_oa_id text,
  ADD COLUMN IF NOT EXISTS line_channel_name text,
  ADD COLUMN IF NOT EXISTS qr_code_url text;

-- ---------------------------------------------------------------- expert_plans
ALTER TABLE public.expert_plans
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'synthetic plan',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS plan_type public.plan_type NOT NULL DEFAULT 'mentor_weekly_journal',
  ADD COLUMN IF NOT EXISTS price_monthly integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS price_yearly integer,
  ADD COLUMN IF NOT EXISTS features jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS review_status public.plan_review_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.expert_plans
    ADD CONSTRAINT expert_plans_expert_id_fkey FOREIGN KEY (expert_id) REFERENCES public.experts(id);
EXCEPTION WHEN duplicate_object THEN END $$;

ALTER TABLE public.expert_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view active plans" ON public.expert_plans;
CREATE POLICY "Anyone can view active plans" ON public.expert_plans FOR SELECT TO public USING (true);

-- ---------------------------------------------------------------- expert_signals
ALTER TABLE public.expert_signals
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS price_hint numeric,
  ADD COLUMN IF NOT EXISTS reason_summary text,
  ADD COLUMN IF NOT EXISTS risk_notes text,
  ADD COLUMN IF NOT EXISTS taken_down_reason text,
  ADD COLUMN IF NOT EXISTS taken_down_by uuid,
  ADD COLUMN IF NOT EXISTS line_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS quantity_unit text,
  ADD COLUMN IF NOT EXISTS teaching_topic text,
  ADD COLUMN IF NOT EXISTS overall_summary text,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS combo_strategy text,
  ADD COLUMN IF NOT EXISTS net_premium numeric,
  ADD COLUMN IF NOT EXISTS max_loss_per_unit numeric,
  ADD COLUMN IF NOT EXISTS max_profit_per_unit numeric;

-- owner write access (save → reload assertion)
DROP POLICY IF EXISTS "Analysts can manage own signals" ON public.expert_signals;
CREATE POLICY "Analysts can manage own signals" ON public.expert_signals FOR ALL TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()))
  WITH CHECK (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------- trade_records
ALTER TABLE public.trade_records
  ADD COLUMN IF NOT EXISTS entry_date timestamptz,
  ADD COLUMN IF NOT EXISTS exit_date timestamptz,
  ADD COLUMN IF NOT EXISTS pnl_percent numeric,
  ADD COLUMN IF NOT EXISTS price_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS combo_strategy text,
  ADD COLUMN IF NOT EXISTS net_premium numeric,
  ADD COLUMN IF NOT EXISTS max_loss_per_unit numeric,
  ADD COLUMN IF NOT EXISTS max_profit_per_unit numeric;
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS is_combo boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- signal templates
CREATE TABLE IF NOT EXISTS public.expert_signal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  title text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  risk_note text NOT NULL,
  strategy_note text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.expert_signal_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Analysts manage own templates" ON public.expert_signal_templates;
CREATE POLICY "Analysts manage own templates" ON public.expert_signal_templates FOR ALL TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()))
  WITH CHECK (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------- prices
CREATE TABLE IF NOT EXISTS public.current_prices (
  symbol text PRIMARY KEY,
  name text,
  price numeric,
  currency text,
  market text,
  asset_class text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.current_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read prices" ON public.current_prices;
CREATE POLICY "Anyone can read prices" ON public.current_prices FOR SELECT TO public USING (true);

-- ---------------------------------------------------------------- grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_signal_templates,
  public.current_prices TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ---------------------------------------------------------------- fx (production column contract)
CREATE TABLE IF NOT EXISTS public.fx_rates (
  currency_pair text PRIMARY KEY,
  rate numeric NOT NULL,
  source text NOT NULL DEFAULT 'seed',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read fx" ON public.fx_rates;
CREATE POLICY "Anyone can read fx" ON public.fx_rates FOR SELECT TO public USING (true);
GRANT SELECT ON public.fx_rates TO anon, authenticated, service_role;
INSERT INTO public.fx_rates (currency_pair, rate, source)
VALUES ('USDTWD', 29.5, 'seed') ON CONFLICT (currency_pair) DO NOTHING;

-- ------------------------------------------------- ambient tables the shell queries
-- The admin shell (bell, subscription banner, RUM beacon) hits these on every
-- route. They are unrelated to the P0 journal chain, but their absence made the
-- clone answer 404/400 and polluted the console-error budget.
DO $$ BEGIN CREATE TYPE public.subscription_status AS ENUM ('active','canceled','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payment_status AS ENUM ('pending','paid','failed','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.announcement_status AS ENUM ('draft','published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.expert_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  plan_type public.plan_type NOT NULL DEFAULT 'analyst_signal_l1',
  price_monthly integer NOT NULL DEFAULT 0,
  price_yearly integer,
  features jsonb DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  review_status public.plan_review_status NOT NULL DEFAULT 'draft',
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.member_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.expert_plans(id) ON DELETE CASCADE,
  status public.subscription_status NOT NULL DEFAULT 'active',
  auto_renew boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  canceled_at timestamptz,
  provider_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  billing_cycle text NOT NULL DEFAULT 'monthly'
);

CREATE TABLE IF NOT EXISTS public.checkup_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  billing_cycle text NOT NULL DEFAULT 'monthly',
  status public.subscription_status NOT NULL DEFAULT 'active',
  auto_renew boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  canceled_at timestamptz,
  provider_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid,
  provider_id uuid,
  amount integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'TWD',
  status public.payment_status NOT NULL DEFAULT 'pending',
  provider_tx_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  attribution jsonb,
  original_amount integer,
  discount_amount integer NOT NULL DEFAULT 0,
  discount_reason text
);

CREATE TABLE IF NOT EXISTS public.remittance_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid,
  billing_cycle text NOT NULL DEFAULT 'monthly',
  amount integer NOT NULL DEFAULT 0,
  original_amount integer,
  discount_amount integer NOT NULL DEFAULT 0,
  discount_reason text,
  last5 text,
  payer_name text,
  attribution jsonb,
  status text NOT NULL DEFAULT 'pending',
  reject_reason text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  subscription_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  product_kind text NOT NULL DEFAULT 'expert_plan',
  checkup_plan_id uuid,
  client_request_id uuid
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  type text NOT NULL DEFAULT 'info',
  is_read boolean NOT NULL DEFAULT false,
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  download_url text
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  status public.announcement_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.perf_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL,
  fcp_ms integer,
  lcp_ms integer,
  user_id uuid,
  session_id text,
  viewport_w integer,
  ua_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  inp_ms integer,
  cls_score numeric
);

ALTER TABLE public.expert_plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkup_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittance_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perf_metrics           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans readable" ON public.expert_plans;
CREATE POLICY "plans readable" ON public.expert_plans FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "own subs" ON public.member_subscriptions;
CREATE POLICY "own subs" ON public.member_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own checkup subs" ON public.checkup_subscriptions;
CREATE POLICY "own checkup subs" ON public.checkup_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own tx" ON public.payment_transactions;
CREATE POLICY "own tx" ON public.payment_transactions FOR SELECT TO authenticated
  USING (subscription_id IN (SELECT id FROM public.member_subscriptions WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "own remittance" ON public.remittance_orders;
CREATE POLICY "own remittance" ON public.remittance_orders FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own notifications" ON public.notifications;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "published announcements" ON public.announcements;
CREATE POLICY "published announcements" ON public.announcements FOR SELECT TO public USING (status = 'published');
DROP POLICY IF EXISTS "rum insert" ON public.perf_metrics;
CREATE POLICY "rum insert" ON public.perf_metrics FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.checkup_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL DEFAULT 'basic',
  name text NOT NULL DEFAULT 'checkup',
  description text,
  price_monthly integer NOT NULL DEFAULT 0,
  price_yearly integer,
  monthly_quota integer,
  features jsonb DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  quota_period text
);
ALTER TABLE public.checkup_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checkup plans readable" ON public.checkup_plans;
CREATE POLICY "checkup plans readable" ON public.checkup_plans FOR SELECT TO public USING (true);

DO $$ BEGIN
  ALTER TABLE public.checkup_subscriptions
    ADD CONSTRAINT checkup_subscriptions_plan_id_fkey FOREIGN KEY (plan_id)
    REFERENCES public.checkup_plans(id);
EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN
  ALTER TABLE public.payment_transactions
    ADD CONSTRAINT payment_transactions_subscription_id_fkey FOREIGN KEY (subscription_id)
    REFERENCES public.member_subscriptions(id);
EXCEPTION WHEN duplicate_object THEN END $$;

GRANT SELECT ON public.expert_plans, public.announcements, public.checkup_plans TO anon, authenticated, service_role;
GRANT SELECT ON public.member_subscriptions, public.checkup_subscriptions,
  public.payment_transactions, public.remittance_orders TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated, service_role;
GRANT INSERT ON public.perf_metrics TO anon, authenticated, service_role;
