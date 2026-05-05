
-- 1) notification_preferences
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY,
  target_price_new boolean NOT NULL DEFAULT true,
  target_price_updated boolean NOT NULL DEFAULT true,
  target_price_weekly boolean NOT NULL DEFAULT true,
  meta_override_changed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notification prefs" ON public.notification_preferences
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins view all notification prefs" ON public.notification_preferences
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'company_admin'::app_role));

-- 2) holding_meta_override_history
CREATE TABLE public.holding_meta_override_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL,
  industry text,
  strategy text,
  leader text,
  position text,
  source text,
  action text NOT NULL DEFAULT 'snapshot',  -- snapshot | rollback | delete
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid
);
CREATE INDEX idx_meta_override_history_user_code ON public.holding_meta_override_history (user_id, code, recorded_at DESC);
ALTER TABLE public.holding_meta_override_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own override history" ON public.holding_meta_override_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins full access override history" ON public.holding_meta_override_history
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'company_admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 3) snapshot trigger on holding_meta_overrides
CREATE OR REPLACE FUNCTION public.snapshot_meta_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.holding_meta_override_history
      (user_id, code, industry, strategy, leader, position, source, action, recorded_by)
    VALUES (OLD.user_id, OLD.code, OLD.industry, OLD.strategy, OLD.leader, OLD.position, OLD.source, 'snapshot', auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.holding_meta_override_history
      (user_id, code, industry, strategy, leader, position, source, action, recorded_by)
    VALUES (OLD.user_id, OLD.code, OLD.industry, OLD.strategy, OLD.leader, OLD.position, OLD.source, 'delete', auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_snapshot_meta_override
  BEFORE UPDATE OR DELETE ON public.holding_meta_overrides
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_meta_override();
