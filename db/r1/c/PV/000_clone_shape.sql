-- =====================================================================
-- PV 000 — production-shape clone for the projection-status view stage.
-- Recreates ONLY what the view + its RLS surface depend on, byte-faithful to
-- the production catalog read read-only on 2026-08-18:
--   roles anon / authenticated / service_role, auth.uid(), app_role enum,
--   trade_status enum, experts / trade_records / expert_signals with their
--   exact production RLS policies and helper functions.
-- Data is SYNTHETIC (shape-equivalent counts only). No production content is
-- ever copied into a clone.
-- =====================================================================
SET client_min_messages = warning;

DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('company_admin','analyst'); EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN CREATE TYPE public.trade_status AS ENUM ('open','closed','stopped'); EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN CREATE TYPE public.expert_role AS ENUM ('advisor','mentor'); EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN CREATE TYPE public.signal_action AS ENUM ('buy','sell','add','trim','exit','hold','teaching'); EXCEPTION WHEN duplicate_object THEN END $$;
DO $$ BEGIN CREATE TYPE public.signal_status AS ENUM ('published','pending'); EXCEPTION WHEN duplicate_object THEN END $$;

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  is_tester boolean NOT NULL DEFAULT false
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
CREATE TABLE public.expert_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL
);
CREATE TABLE public.member_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NULL
);

CREATE TABLE public.experts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  role public.expert_role NOT NULL DEFAULT 'advisor',
  status text NOT NULL DEFAULT 'pending',
  currency text NOT NULL DEFAULT 'TWD',
  asset_class text NOT NULL DEFAULT 'tw_stock',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.trade_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  signal_id uuid NULL,
  instrument text NOT NULL,
  entry_price numeric NULL,
  exit_price numeric NULL,
  current_price numeric NULL,
  quantity integer NOT NULL,
  quantity_unit text NOT NULL DEFAULT '股',
  status public.trade_status NOT NULL DEFAULT 'open',
  market text NULL,
  currency text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.expert_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  instrument text NOT NULL,
  action public.signal_action NOT NULL DEFAULT 'teaching',
  status public.signal_status NOT NULL DEFAULT 'published',
  reason_detail text NULL,
  learning_points text NULL,
  market text NOT NULL DEFAULT 'TW',
  is_combo boolean NOT NULL DEFAULT false,
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.experts, public.trade_records,
  public.expert_signals, public.profiles, public.user_roles, public.expert_plans,
  public.member_subscriptions TO anon, authenticated, service_role;

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.is_tester(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT is_tester FROM public.profiles WHERE user_id = _user_id LIMIT 1), false)
$$;
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
RETURNS TABLE(plan_id uuid, expert_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ms.plan_id, ep.expert_id
    FROM public.member_subscriptions ms
    JOIN public.expert_plans ep ON ep.id = ms.plan_id
   WHERE ms.user_id = _user_id AND ms.status = 'active'
     AND (ms.expires_at IS NULL OR ms.expires_at > now())
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role),
  public.is_tester(uuid), public.has_active_subscription(uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------- RLS (exact production predicates)
ALTER TABLE public.experts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active experts" ON public.experts FOR SELECT TO public
  USING ((status = 'active'::text) OR ((status = 'draft'::text) AND is_tester(auth.uid())));
CREATE POLICY "Analysts can view own expert" ON public.experts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Company admins full access experts" ON public.experts FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));
CREATE POLICY "Subscribers can view subscribed experts" ON public.experts FOR SELECT TO authenticated
  USING ((id IN (SELECT expert_id FROM has_active_subscription(auth.uid())))
         AND ((status = 'active'::text) OR is_tester(auth.uid())));

CREATE POLICY "Anyone can view open trades for active experts" ON public.trade_records FOR SELECT TO public
  USING ((status = 'open'::trade_status)
         AND (expert_id IN (SELECT experts.id FROM experts WHERE experts.status = 'active'::text)));
CREATE POLICY "Anyone can view closed trades for active experts" ON public.trade_records FOR SELECT TO public
  USING ((status = ANY (ARRAY['closed'::trade_status,'stopped'::trade_status]))
         AND ((expert_id IN (SELECT experts.id FROM experts WHERE experts.status = 'active'::text))
              OR is_tester(auth.uid())));
CREATE POLICY "Analysts can view own trades" ON public.trade_records FOR SELECT TO authenticated
  USING (expert_id IN (SELECT experts.id FROM experts WHERE experts.user_id = auth.uid()));
CREATE POLICY "Company admins can view all trades" ON public.trade_records FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));
CREATE POLICY "Subscribers can view subscribed expert trades" ON public.trade_records FOR SELECT TO authenticated
  USING (expert_id IN (SELECT expert_id FROM has_active_subscription(auth.uid())));

CREATE POLICY "Analysts can view own signals" ON public.expert_signals FOR SELECT TO authenticated
  USING (expert_id IN (SELECT experts.id FROM experts WHERE experts.user_id = auth.uid()));
CREATE POLICY "Company admins can view all signals" ON public.expert_signals FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));

-- ---------------------------------------------------------------- synthetic fixture
-- 13 experts (5 active / 2 suspended / 6 pending), 173 signals + 82 trades
-- distributed over the 5 active experts — the production SHAPE from the
-- sanitized manifests, with synthetic identifiers and no expert content.
DO $seed$
DECLARE
  i int; j int; eid uuid; uid uuid; st text; n int;
BEGIN
  FOR i IN 1..13 LOOP
    st := CASE WHEN i <= 5 THEN 'active' WHEN i <= 7 THEN 'suspended' ELSE 'pending' END;
    uid := ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    eid := ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO public.experts (id, user_id, slug, name, status)
      VALUES (eid, uid, 'expert-' || i, 'E' || i, st);
    INSERT INTO public.profiles (user_id, is_tester) VALUES (uid, false);
  END LOOP;

  -- 173 signals: 35/35/35/34/34 over the 5 active experts
  FOR i IN 1..5 LOOP
    eid := ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid;
    n := CASE WHEN i <= 3 THEN 35 ELSE 34 END;
    FOR j IN 1..n LOOP
      INSERT INTO public.expert_signals (expert_id, instrument, reason_detail, published_at)
        VALUES (eid, 'SYN' || i || '-' || j, 'synthetic-body-' || i || '-' || j, now());
    END LOOP;
  END LOOP;

  -- 82 trades: 17/17/16/16/16, of which 21 open, all with a non-null entry price
  FOR i IN 1..5 LOOP
    eid := ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid;
    n := CASE WHEN i <= 2 THEN 17 ELSE 16 END;
    FOR j IN 1..n LOOP
      INSERT INTO public.trade_records
        (expert_id, instrument, entry_price, current_price, quantity, status)
      VALUES (eid, 'SYN' || i || '-' || j, 100 + j, 110 + j, 1000,
              CASE WHEN j <= 5 OR (i = 1 AND j = 6) THEN 'open'::trade_status ELSE 'closed'::trade_status END);
    END LOOP;
  END LOOP;

  -- true-zero fixture: a real open position whose quantity is 0 (valid data)
  UPDATE public.trade_records SET quantity = 0
   WHERE id = (SELECT id FROM public.trade_records
                WHERE expert_id = '00000000-0000-4000-9000-000000000001'::uuid
                  AND status = 'open' ORDER BY instrument LIMIT 1);
END $seed$;
