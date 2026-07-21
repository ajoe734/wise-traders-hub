
-- Audit trigger: log every INSERT/UPDATE/DELETE on trade_records and expert_signals
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_via text;
  v_target uuid;
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_expert uuid;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN v_actor := NULL;
  END;

  BEGIN
    v_via := auth.role();
  EXCEPTION WHEN OTHERS THEN v_via := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    v_target := (v_before->>'id')::uuid;
    v_expert := NULLIF(v_before->>'expert_id','')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
    v_target := (v_after->>'id')::uuid;
    v_expert := NULLIF(v_after->>'expert_id','')::uuid;
  ELSE  -- UPDATE
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_target := (v_after->>'id')::uuid;
    v_expert := NULLIF(v_after->>'expert_id','')::uuid;
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO v_changed
    FROM (
      SELECT key AS k
      FROM jsonb_each(v_after) a
      WHERE key NOT IN ('updated_at')
        AND (v_before->key) IS DISTINCT FROM a.value
    ) diff;
    -- No effective change => skip
    IF v_changed IS NULL OR array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
  VALUES (
    v_actor,
    TG_TABLE_NAME || '.' || TG_OP,
    TG_TABLE_NAME,
    v_target,
    jsonb_strip_nulls(jsonb_build_object(
      'op', TG_OP,
      'table', TG_TABLE_NAME,
      'via', v_via,
      'expert_id', v_expert,
      'before', v_before,
      'after', v_after,
      'changed', to_jsonb(v_changed)
    ))
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit_row_change failed for % %: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC;

-- trade_records triggers
DROP TRIGGER IF EXISTS trg_audit_trade_records_ins ON public.trade_records;
DROP TRIGGER IF EXISTS trg_audit_trade_records_upd ON public.trade_records;
DROP TRIGGER IF EXISTS trg_audit_trade_records_del ON public.trade_records;
CREATE TRIGGER trg_audit_trade_records_ins
  AFTER INSERT ON public.trade_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_trade_records_upd
  AFTER UPDATE ON public.trade_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_trade_records_del
  AFTER DELETE ON public.trade_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- expert_signals triggers
DROP TRIGGER IF EXISTS trg_audit_expert_signals_ins ON public.expert_signals;
DROP TRIGGER IF EXISTS trg_audit_expert_signals_upd ON public.expert_signals;
DROP TRIGGER IF EXISTS trg_audit_expert_signals_del ON public.expert_signals;
CREATE TRIGGER trg_audit_expert_signals_ins
  AFTER INSERT ON public.expert_signals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_expert_signals_upd
  AFTER UPDATE ON public.expert_signals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_expert_signals_del
  AFTER DELETE ON public.expert_signals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- Allow service_role explicit insert (defense-in-depth; SECURITY DEFINER already bypasses)
DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.audit_logs;
CREATE POLICY "Service role can insert audit logs"
  ON public.audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

GRANT ALL ON public.audit_logs TO service_role;
