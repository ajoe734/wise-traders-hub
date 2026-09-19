-- P0_SIGNAL_MATH_CONTRACT_V1 — 唯讀差異報告（只 SELECT，零 mutation）
-- 目的：盤點正式資料中「依舊口徑會算錯」的痕跡，供核准後的資料修正計畫使用。
-- 本檔只讀；任何實際修正（trade_records 單位正規化、orphan 補帳）都要另外核准。

-- R1. unit 歧義：trade_records.unit='張' 但 quantity 已是股數（>100 且為 1000 的倍數）
--     → 任何「張×1000」口徑的消費者（如 useExpertCapital.ts）會放大 1000 倍
SELECT
  tr.expert_id,
  e.name AS expert_name,
  tr.id AS trade_record_id,
  tr.action,
  tr.price,
  tr.quantity,
  tr.unit,
  tr.trade_date
FROM trade_records tr
JOIN experts e ON e.id = tr.expert_id
WHERE tr.unit = '張'
  AND tr.quantity >= 100
  AND tr.quantity % 1000 = 0
ORDER BY tr.trade_date DESC;

-- R2. orphan signals：published 且無對應 trade_records 的 expert_signals
--     → get_expert_holdings_view / build_performance_view 直接漏算這些交易
SELECT
  es.id AS signal_id,
  e.name AS expert_name,
  es.instrument,
  es.action,
  es.entry_price,
  es.quantity,
  es.quantity_unit,
  es.created_at
FROM expert_signals es
JOIN experts e ON e.id = es.expert_id
LEFT JOIN trade_records tr
  ON tr.expert_id = es.expert_id
 AND tr.trade_date = es.created_at::date
WHERE es.status = 'published'
  AND es.action IN ('buy', 'sell', 'add', 'trim', 'exit')
  AND tr.id IS NULL
ORDER BY es.created_at DESC;

-- R3. 現金模擬差異：同一老師的 exit 交易，舊口徑（成本價）vs 新口徑（實際出場價）的現金差額合計
--     正值 = 舊口徑少算了已實現獲利進現金
SELECT
  tr.expert_id,
  e.name AS expert_name,
  COUNT(*) FILTER (WHERE tr.action = 'exit') AS exit_count,
  ROUND(SUM(
    CASE WHEN tr.action = 'exit' THEN
      -- 新口徑：實際出場價 × 股數；舊口徑：成本 × 股數（成本以同標的買進加權均價近似）
      tr.price * tr.quantity
      - COALESCE((
          SELECT SUM(b.price * b.quantity) / NULLIF(SUM(b.quantity), 0)
          FROM trade_records b
          WHERE b.expert_id = tr.expert_id
            AND b.stock_code = tr.stock_code
            AND b.action IN ('buy', 'add')
            AND b.trade_date <= tr.trade_date
        ), tr.price) * tr.quantity
    ELSE 0 END
  ), 2) AS cash_understatement_vs_new_contract
FROM trade_records tr
JOIN experts e ON e.id = tr.expert_id
GROUP BY tr.expert_id, e.name
HAVING COUNT(*) FILTER (WHERE tr.action = 'exit') > 0
ORDER BY cash_understatement_vs_new_contract DESC;
