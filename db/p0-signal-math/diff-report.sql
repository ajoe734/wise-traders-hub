-- P0_SIGNAL_MATH_CONTRACT_V1 — 唯讀差異報告（只 SELECT，零 mutation）
-- 目的：盤點正式資料中「依舊口徑會算錯」的痕跡，供核准後的資料修正計畫使用。
-- 本檔只讀；任何實際修正（trade_records 單位正規化、orphan 補帳）都要另外核准。
-- 三條查詢各自獨立執行（read_query 一次一條）。

-- R1. 單位歧義：quantity_unit='張' 但 quantity 已是股數（>=100 且為 1000 的倍數）
--     → 任何「張×1000」口徑的消費者會放大 1000 倍（00708L 反例屬此類）
SELECT
  tr.expert_id,
  e.name AS expert_name,
  tr.id AS trade_record_id,
  tr.signal_id,
  tr.instrument,
  tr.entry_price,
  tr.quantity,
  tr.quantity_unit,
  tr.status,
  tr.entry_date
FROM trade_records tr
JOIN experts e ON e.id = tr.expert_id
WHERE tr.quantity_unit = '張'
  AND tr.quantity >= 100
  AND tr.quantity % 1000 = 0
ORDER BY tr.entry_date DESC;

-- R2. orphan signals：published 交易訊號，沒有任何 trade_records 透過 signal_id 對應
--     → get_expert_holdings_view / 績效 view 直接漏算這些交易（3006/6526/3035 反例屬此類）
SELECT
  es.id AS signal_id,
  e.name AS expert_name,
  es.instrument,
  es.action,
  es.entry_price,
  es.quantity,
  es.quantity_unit,
  es.status,
  es.created_at
FROM expert_signals es
JOIN experts e ON e.id = es.expert_id
WHERE es.status = 'published'
  AND es.action IN ('buy', 'sell', 'add', 'trim', 'exit')
  AND NOT EXISTS (
    SELECT 1 FROM trade_records tr WHERE tr.signal_id = es.id
  )
ORDER BY es.created_at DESC;

-- R3. 現金模擬差異：已結案且獲利的 trade_records，舊口徑（成本價釋放現金）少算的金額
--     正值 = 舊 exit 分支少把已實現獲利計入現金（6706 反例屬此類）
SELECT
  tr.expert_id,
  e.name AS expert_name,
  COUNT(*) AS profitable_closed_count,
  ROUND(SUM(
    (tr.exit_price - tr.entry_price)
    * tr.quantity
    * CASE WHEN tr.quantity_unit = '張' THEN 1000 ELSE 1 END
  ), 2) AS cash_understatement_vs_new_contract
FROM trade_records tr
JOIN experts e ON e.id = tr.expert_id
WHERE tr.status = 'closed'
  AND tr.exit_price IS NOT NULL
  AND tr.exit_price > tr.entry_price
GROUP BY tr.expert_id, e.name
ORDER BY cash_understatement_vs_new_contract DESC;
