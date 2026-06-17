-- 多幣別支援：experts / current_prices / stock_names

-- 1) experts.currency：TWD 預設，限制 TWD/USD
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TWD';

ALTER TABLE public.experts
  DROP CONSTRAINT IF EXISTS experts_currency_check;
ALTER TABLE public.experts
  ADD CONSTRAINT experts_currency_check CHECK (currency IN ('TWD','USD'));

-- 2) current_prices.currency：報價來源幣別
ALTER TABLE public.current_prices
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TWD';

ALTER TABLE public.current_prices
  DROP CONSTRAINT IF EXISTS current_prices_currency_check;
ALTER TABLE public.current_prices
  ADD CONSTRAINT current_prices_currency_check CHECK (currency IN ('TWD','USD'));

-- 3) stock_names.currency / market：判別美股名稱與市場
ALTER TABLE public.stock_names
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TWD';
ALTER TABLE public.stock_names
  ADD COLUMN IF NOT EXISTS market text;

ALTER TABLE public.stock_names
  DROP CONSTRAINT IF EXISTS stock_names_currency_check;
ALTER TABLE public.stock_names
  ADD CONSTRAINT stock_names_currency_check CHECK (currency IN ('TWD','USD'));

-- 4) Trigger: 一旦該 expert 已有任何 expert_signal，禁止改 currency（避免歷史資料幣別不一致）
CREATE OR REPLACE FUNCTION public.enforce_expert_currency_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更幣別（currency lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_expert_currency_lock ON public.experts;
CREATE TRIGGER trg_enforce_expert_currency_lock
  BEFORE UPDATE OF currency ON public.experts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expert_currency_lock();