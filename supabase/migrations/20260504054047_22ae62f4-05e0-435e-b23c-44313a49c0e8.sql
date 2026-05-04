-- 1) Trigger function: forbid is_default=true on inactive providers; auto-clear is_default when deactivating
CREATE OR REPLACE FUNCTION public.enforce_payment_provider_default_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If marking as default, must be active
  IF NEW.is_default = true AND NEW.is_active = false THEN
    RAISE EXCEPTION '無法將未啟用的金流通道設為預設 (provider_type=%, display_name=%)',
      NEW.provider_type, NEW.display_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Auto-clear default when going inactive
  IF NEW.is_active = false AND NEW.is_default = true THEN
    NEW.is_default := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_provider_default_active ON public.payment_providers;
CREATE TRIGGER trg_enforce_payment_provider_default_active
BEFORE INSERT OR UPDATE ON public.payment_providers
FOR EACH ROW
EXECUTE FUNCTION public.enforce_payment_provider_default_active();

-- 2) Clean up existing inconsistent rows (ACpay is currently is_default=true but is_active=false)
UPDATE public.payment_providers
SET is_default = false
WHERE is_default = true AND is_active = false;