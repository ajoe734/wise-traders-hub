-- 修復 trade_records 單位漂移：46 筆 market='TW' AND quantity_unit='股'
-- 分類處理：
--   A) 9 筆美股（currency='USD'）誤標 market='TW' → 改為 'US'，單位 '股' 維持
--   B) 26 筆台股/權證 quantity 為 1000 倍數且對應 expert_signals 有 '張' 單位 → quantity/=1000, 單位='張'
--   C) 剩餘 11 筆（零股 100~500、暫留權證 062787、以及 6285 啟碁）維持 '股'（合法零股/主要單位為股）
-- 遷移期間暫時停用 enforce_unit_consistency 觸發器，避免跨紀錄同標的的暫態衝突誤擋。

ALTER TABLE public.trade_records DISABLE TRIGGER trg_enforce_unit_consistency_trade_records;

-- A) USD 資料回歸美股市場
UPDATE public.trade_records
SET market = 'US'
WHERE market = 'TW'
  AND quantity_unit = '股'
  AND currency = 'USD';

-- B) TWD × 1000 倍 × 對應 signals 有 '張' → 換算成 張
UPDATE public.trade_records tr
SET quantity = tr.quantity / 1000,
    quantity_unit = '張'
WHERE tr.market = 'TW'
  AND tr.quantity_unit = '股'
  AND tr.currency = 'TWD'
  AND tr.quantity % 1000 = 0
  AND EXISTS (
    SELECT 1 FROM public.expert_signals s
    WHERE s.expert_id = tr.expert_id
      AND split_part(btrim(s.instrument), ' ', 1) = split_part(btrim(tr.instrument), ' ', 1)
      AND s.quantity_unit = '張'
  );

ALTER TABLE public.trade_records ENABLE TRIGGER trg_enforce_unit_consistency_trade_records;

-- 補強：在 INSERT/UPDATE 時攔截「TW 市場又填 USD」的方向漂移，避免未來再度污染
CREATE OR REPLACE FUNCTION public.enforce_trade_record_market_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.market IS NOT NULL AND NEW.currency IS NOT NULL THEN
    IF NEW.market = 'TW' AND NEW.currency <> 'TWD' THEN
      RAISE EXCEPTION 'market_currency_mismatch: market=TW 只能搭配 currency=TWD（收到 currency=%）', NEW.currency
        USING ERRCODE = 'check_violation',
              HINT = 'MARKET_CURRENCY_LOCK: 若為美股請將 market 改為 US';
    ELSIF NEW.market = 'US' AND NEW.currency <> 'USD' THEN
      RAISE EXCEPTION 'market_currency_mismatch: market=US 只能搭配 currency=USD（收到 currency=%）', NEW.currency
        USING ERRCODE = 'check_violation',
              HINT = 'MARKET_CURRENCY_LOCK: 若為台股請將 market 改為 TW';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_trade_record_market_currency ON public.trade_records;
CREATE TRIGGER trg_enforce_trade_record_market_currency
BEFORE INSERT OR UPDATE OF market, currency
ON public.trade_records
FOR EACH ROW EXECUTE FUNCTION public.enforce_trade_record_market_currency();