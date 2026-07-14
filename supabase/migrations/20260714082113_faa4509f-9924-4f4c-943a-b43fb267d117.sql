-- ============================================================
-- 資產類別擴充：tw_stock / us_stock / crypto
-- ============================================================

-- 1) experts.asset_class
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'tw_stock';

UPDATE public.experts
SET asset_class = CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END
WHERE asset_class = 'tw_stock' AND currency IS NOT NULL;

ALTER TABLE public.experts
  DROP CONSTRAINT IF EXISTS experts_asset_class_check;
ALTER TABLE public.experts
  ADD CONSTRAINT experts_asset_class_check
  CHECK (asset_class IN ('tw_stock','us_stock','crypto'));

-- 2) current_prices.asset_class
ALTER TABLE public.current_prices
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'tw_stock';

UPDATE public.current_prices
SET asset_class = CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END
WHERE asset_class = 'tw_stock' AND currency IS NOT NULL;

ALTER TABLE public.current_prices
  DROP CONSTRAINT IF EXISTS current_prices_asset_class_check;
ALTER TABLE public.current_prices
  ADD CONSTRAINT current_prices_asset_class_check
  CHECK (asset_class IN ('tw_stock','us_stock','crypto'));

-- 3) stock_names.asset_class
ALTER TABLE public.stock_names
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'tw_stock';

UPDATE public.stock_names
SET asset_class = CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END
WHERE asset_class = 'tw_stock' AND currency IS NOT NULL;

ALTER TABLE public.stock_names
  DROP CONSTRAINT IF EXISTS stock_names_asset_class_check;
ALTER TABLE public.stock_names
  ADD CONSTRAINT stock_names_asset_class_check
  CHECK (asset_class IN ('tw_stock','us_stock','crypto'));

-- 4) Trigger: 一旦該 expert 已有任何 expert_signal，禁止改 asset_class
CREATE OR REPLACE FUNCTION public.enforce_expert_asset_class_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.asset_class IS DISTINCT FROM OLD.asset_class THEN
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更資產類別（asset_class lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_expert_asset_class_lock ON public.experts;
CREATE TRIGGER trg_enforce_expert_asset_class_lock
  BEFORE UPDATE OF asset_class ON public.experts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expert_asset_class_lock();

-- 5) Trigger: 資產類別與幣別同步（保底）
CREATE OR REPLACE FUNCTION public.sync_expert_currency_with_asset_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.asset_class = 'tw_stock' THEN
    NEW.currency := 'TWD';
  ELSIF NEW.asset_class IN ('us_stock','crypto') THEN
    NEW.currency := 'USD';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_expert_currency ON public.experts;
CREATE TRIGGER trg_sync_expert_currency
  BEFORE INSERT OR UPDATE OF asset_class ON public.experts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_expert_currency_with_asset_class();

-- 6) crypto_symbol_map：加密貨幣代碼對照
CREATE TABLE IF NOT EXISTS public.crypto_symbol_map (
  symbol text PRIMARY KEY,
  coingecko_id text NOT NULL,
  binance_pair text,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crypto_symbol_map TO anon, authenticated;
GRANT ALL ON public.crypto_symbol_map TO service_role;

ALTER TABLE public.crypto_symbol_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crypto_symbol_map public read" ON public.crypto_symbol_map;
CREATE POLICY "crypto_symbol_map public read"
  ON public.crypto_symbol_map FOR SELECT
  USING (true);

INSERT INTO public.crypto_symbol_map (symbol, coingecko_id, binance_pair, display_name) VALUES
  ('BTC','bitcoin','BTCUSDT','Bitcoin'),
  ('ETH','ethereum','ETHUSDT','Ethereum'),
  ('SOL','solana','SOLUSDT','Solana'),
  ('BNB','binancecoin','BNBUSDT','BNB'),
  ('XRP','ripple','XRPUSDT','XRP'),
  ('ADA','cardano','ADAUSDT','Cardano'),
  ('DOGE','dogecoin','DOGEUSDT','Dogecoin'),
  ('TON','the-open-network','TONUSDT','Toncoin'),
  ('LINK','chainlink','LINKUSDT','Chainlink'),
  ('AVAX','avalanche-2','AVAXUSDT','Avalanche'),
  ('DOT','polkadot','DOTUSDT','Polkadot'),
  ('MATIC','matic-network','MATICUSDT','Polygon'),
  ('LTC','litecoin','LTCUSDT','Litecoin'),
  ('BCH','bitcoin-cash','BCHUSDT','Bitcoin Cash'),
  ('UNI','uniswap','UNIUSDT','Uniswap')
ON CONFLICT (symbol) DO NOTHING;