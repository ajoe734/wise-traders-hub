-- 自動推導 market
CREATE OR REPLACE FUNCTION public.set_expert_signal_market()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ac text;
  v_cur text;
BEGIN
  IF NEW.market IS NOT NULL AND NEW.market <> '' THEN
    RETURN NEW;
  END IF;

  SELECT asset_class, currency INTO v_ac, v_cur
    FROM public.experts WHERE id = NEW.expert_id;

  NEW.market := CASE
    WHEN v_ac = 'tw_stock' THEN 'TW'
    WHEN v_ac IN ('us_stock','us_option','us_future') THEN 'US'
    WHEN v_cur = 'TWD' THEN 'TW'
    WHEN v_cur = 'USD' THEN 'US'
    ELSE 'TW'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_expert_signal_market ON public.expert_signals;
CREATE TRIGGER trg_set_expert_signal_market
BEFORE INSERT OR UPDATE OF market, expert_id ON public.expert_signals
FOR EACH ROW EXECUTE FUNCTION public.set_expert_signal_market();

-- 收斂 NOT NULL
ALTER TABLE public.expert_signals ALTER COLUMN market SET NOT NULL;