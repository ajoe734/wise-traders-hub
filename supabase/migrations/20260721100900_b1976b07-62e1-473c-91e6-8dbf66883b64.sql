
CREATE OR REPLACE FUNCTION public.enforce_signal_capital_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_shares integer;
  v_required numeric;
  v_available numeric;
  v_status jsonb;
  v_currency text;
BEGIN
  -- Only buy/add matter
  IF NEW.action NOT IN ('buy','add') THEN
    RETURN NEW;
  END IF;

  -- Only enforce when actually going live. Drafts (pending) always pass.
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE: only enforce when transitioning INTO published from a non-published state
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- company_admin bypass
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  v_shares := CASE
    WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
    WHEN COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
    ELSE COALESCE(NEW.quantity, 1)
  END;

  v_required := COALESCE(NEW.price_hint, 0) * v_shares;

  v_status := public.get_expert_capital_status(NEW.expert_id);
  v_available := COALESCE((v_status->>'available_cash')::numeric, 0);

  SELECT COALESCE(currency, 'TWD') INTO v_currency
    FROM public.experts WHERE id = NEW.expert_id;

  IF v_required > v_available THEN
    RAISE EXCEPTION
      'CAPITAL_EXCEEDED: 此筆需 % %，可用現金僅 % %。請至「分析師設定」調整初始資金，或減少數量。',
      v_required, v_currency, v_available, v_currency
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Ensure trigger covers both INSERT and the pending→published UPDATE path
DROP TRIGGER IF EXISTS enforce_signal_capital_limit_trg ON public.expert_signals;
CREATE TRIGGER enforce_signal_capital_limit_trg
BEFORE INSERT OR UPDATE OF status, quantity, quantity_unit, price_hint, action
ON public.expert_signals
FOR EACH ROW EXECUTE FUNCTION public.enforce_signal_capital_limit();
