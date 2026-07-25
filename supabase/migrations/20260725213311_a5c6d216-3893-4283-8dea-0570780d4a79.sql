
CREATE OR REPLACE VIEW public.v_price_sync_universe AS
WITH raw_symbols AS (
  SELECT TRIM(BOTH FROM split_part(trade_records.instrument, ' ', 1)) AS symbol
    FROM trade_records
   WHERE trade_records.status = 'open'::trade_status AND trade_records.instrument IS NOT NULL
  UNION
  SELECT TRIM(BOTH FROM split_part(expert_signals.instrument, ' ', 1)) AS symbol
    FROM expert_signals
   WHERE expert_signals.instrument IS NOT NULL AND expert_signals.created_at >= (now() - interval '180 days')
  UNION
  SELECT upper(crypto_symbol_map.symbol) AS symbol
    FROM crypto_symbol_map WHERE crypto_symbol_map.is_active = true
  UNION
  SELECT upper(TRIM(BOTH FROM elem.value ->> 'code')) AS symbol
    FROM checkup_storage,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(checkup_storage.data) = 'array' THEN checkup_storage.data ELSE '[]'::jsonb END
         ) elem(value)
   WHERE checkup_storage.key = 'pf-holdings-v2' AND elem.value ? 'code'
),
crypto_set AS (
  SELECT upper(symbol) AS symbol FROM crypto_symbol_map WHERE is_active = true
),
classified AS (
  SELECT
    r.symbol,
    CASE
      -- Crypto 優先：任何在 crypto_symbol_map 中的都歸 CRYPTO
      WHEN r.symbol IN (SELECT symbol FROM crypto_set) THEN 'CRYPTO'
      WHEN r.symbol ~ '^\d{4}$' THEN 'TW'
      WHEN r.symbol ~ '^[03567]\d{5}$' THEN 'TW'
      WHEN r.symbol ~ '^[A-Z]{1,5}(\.[A-Z])?$' THEN 'US'
      ELSE NULL
    END AS market,
    CASE
      WHEN r.symbol ~ '^[03567]\d{5}$' THEN 20
      WHEN r.symbol ~ '^\d{4}$' THEN 10
      WHEN r.symbol ~ '^[A-Z]{1,5}$' THEN 10
      ELSE 30
    END AS priority
  FROM raw_symbols r
  WHERE r.symbol IS NOT NULL AND r.symbol <> ''
)
SELECT DISTINCT symbol, market, priority
  FROM classified
 WHERE market IS NOT NULL;

-- 順手清掉錯誤寫入 US 的 crypto 資料
DELETE FROM public.current_prices
 WHERE market = 'US'
   AND symbol IN (SELECT upper(symbol) FROM public.crypto_symbol_map WHERE is_active = true);
