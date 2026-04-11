
-- Step 1: Drop ALL blocking dependencies
DROP TRIGGER IF EXISTS on_signal_takedown ON public.expert_signals;
DROP TRIGGER IF EXISTS on_signal_trade ON public.expert_signals;

DROP POLICY IF EXISTS "Subscribers can view signals published after subscription start" ON public.expert_signals;
DROP POLICY IF EXISTS "Analysts can delete own signals" ON public.expert_signals;
DROP POLICY IF EXISTS "Analysts can insert own signals" ON public.expert_signals;
DROP POLICY IF EXISTS "Analysts can update own signals" ON public.expert_signals;
DROP POLICY IF EXISTS "Analysts can view own signals" ON public.expert_signals;
DROP POLICY IF EXISTS "Company admins full access signals" ON public.expert_signals;

-- Step 2: Check if old type exists from partial migration, clean up
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signal_status_old') THEN
    -- Previous rename happened, just drop the old one if new one exists
    ALTER TABLE public.expert_signals
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE text USING status::text;
    DROP TYPE IF EXISTS public.signal_status_old;
    DROP TYPE IF EXISTS public.signal_status;
    CREATE TYPE public.signal_status AS ENUM ('published', 'pending');
    ALTER TABLE public.expert_signals
      ALTER COLUMN status TYPE public.signal_status USING status::public.signal_status,
      ALTER COLUMN status SET DEFAULT 'published'::public.signal_status;
  ELSE
    -- Normal path
    ALTER TABLE public.expert_signals
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE text USING status::text;
    DROP TYPE public.signal_status;
    CREATE TYPE public.signal_status AS ENUM ('published', 'pending');
    ALTER TABLE public.expert_signals
      ALTER COLUMN status TYPE public.signal_status USING status::public.signal_status,
      ALTER COLUMN status SET DEFAULT 'published'::public.signal_status;
  END IF;
END $$;

-- Step 3: Recreate policies
CREATE POLICY "Analysts can delete own signals" ON public.expert_signals
  FOR DELETE TO authenticated
  USING (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()));

CREATE POLICY "Analysts can insert own signals" ON public.expert_signals
  FOR INSERT TO authenticated
  WITH CHECK (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()));

CREATE POLICY "Analysts can update own signals" ON public.expert_signals
  FOR UPDATE TO authenticated
  USING (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()));

CREATE POLICY "Analysts can view own signals" ON public.expert_signals
  FOR SELECT TO authenticated
  USING (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()));

CREATE POLICY "Company admins full access signals" ON public.expert_signals
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Subscribers can view signals published after subscription start" ON public.expert_signals
  FOR SELECT TO public
  USING (
    status = 'published'::signal_status
    AND expert_id IN (
      SELECT expert_id FROM has_active_subscription_after(auth.uid(), expert_signals.published_at)
    )
  );

-- Step 4: Recreate the trade trigger (important for signal publishing)
CREATE TRIGGER on_signal_trade
  AFTER INSERT OR UPDATE ON public.expert_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_signal_trade();
