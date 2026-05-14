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
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
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

DROP TRIGGER IF EXISTS trg_enforce_signal_recall_same_day_del ON public.expert_signals;
CREATE TRIGGER trg_enforce_signal_recall_same_day_del
BEFORE DELETE ON public.expert_signals
FOR EACH ROW EXECUTE FUNCTION public.enforce_signal_recall_same_day();