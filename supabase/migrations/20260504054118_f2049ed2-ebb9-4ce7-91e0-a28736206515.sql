CREATE OR REPLACE FUNCTION public.enforce_payment_provider_default_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default = true AND NEW.is_active = false THEN
    RAISE EXCEPTION '無法將未啟用的金流通道設為預設 (provider_type=%, display_name=%)',
      NEW.provider_type, NEW.display_name
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.is_active = false AND NEW.is_default = true THEN
    NEW.is_default := false;
  END IF;
  RETURN NEW;
END;
$$;