
CREATE OR REPLACE FUNCTION public.enforce_signal_recall_same_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pub_day date;
  today_tw date;
BEGIN
  -- Admin bypass
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only enforce when transitioning published -> taken_down
    IF OLD.status = 'published' AND NEW.status = 'taken_down' THEN
      IF OLD.published_at IS NULL THEN
        RETURN NEW;
      END IF;
      pub_day := (OLD.published_at AT TIME ZONE 'Asia/Taipei')::date;
      today_tw := (now() AT TIME ZONE 'Asia/Taipei')::date;
      IF pub_day <> today_tw THEN
        RAISE EXCEPTION 'RECALL_EXPIRED: 已過發布當日（台灣時間），不可收回；如需修正請聯絡管理員'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Block deletion of already-published signals after the publish day
    IF OLD.status = 'published' AND OLD.published_at IS NOT NULL THEN
      pub_day := (OLD.published_at AT TIME ZONE 'Asia/Taipei')::date;
      today_tw := (now() AT TIME ZONE 'Asia/Taipei')::date;
      IF pub_day <> today_tw THEN
        RAISE EXCEPTION 'RECALL_EXPIRED: 已過發布當日（台灣時間），不可刪除已發布訊號'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_signal_recall_same_day_upd ON public.expert_signals;
CREATE TRIGGER trg_enforce_signal_recall_same_day_upd
BEFORE UPDATE ON public.expert_signals
FOR EACH ROW EXECUTE FUNCTION public.enforce_signal_recall_same_day();

DROP TRIGGER IF EXISTS trg_enforce_signal_recall_same_day_del ON public.expert_signals;
CREATE TRIGGER trg_enforce_signal_recall_same_day_del
BEFORE DELETE ON public.expert_signals
FOR EACH ROW EXECUTE FUNCTION public.enforce_signal_recall_same_day();
