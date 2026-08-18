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
  ADD COLUMN IF NOT EXISTS strategy_name text;

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

-- ---------------------------------------------------------------- fx (footnote hook)
CREATE TABLE IF NOT EXISTS public.fx_rates (
  pair text PRIMARY KEY,
  rate numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read fx" ON public.fx_rates;
CREATE POLICY "Anyone can read fx" ON public.fx_rates FOR SELECT TO public USING (true);
GRANT SELECT ON public.fx_rates TO anon, authenticated, service_role;
