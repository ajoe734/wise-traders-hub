-- Holdings 三口徑一致性審計（一次性、read-only）
-- A: trade_records（帳本）
-- B: expert_signals（已發布訊號流水，含 add/trim/exit）
-- C: 週記匯出總計（只算 buy/sell，per unit）
-- 規則：TW  1 張 = 1000 股；其他一律以 raw quantity 計（unit_factor=1）

\pset pager off
\pset format aligned
\pset border 2
\timing off

\echo
\echo '### 0. 掃描概要'
SELECT
  (SELECT count(*) FROM experts)                                       AS total_experts,
  (SELECT count(*) FROM trade_records)                                 AS total_trades,
  (SELECT count(*) FROM expert_signals WHERE status = 'published')     AS total_published_signals,
  (SELECT count(*) FROM expert_signals WHERE status = 'pending')       AS total_pending_signals;

-- 通用 CTE：把 instrument 拆出 symbol（前置英數字元），unit_factor（張=1000, 其他=1）
-- 只針對 quantity 有意義的 action（排除 teaching）

\echo
\echo '### 1. ORPHAN_PENDING — pending 超過 7 天未發布的訊號（彥愷案主兇）'
WITH orphan AS (
  SELECT
    s.id,
    e.slug        AS expert_slug,
    e.name        AS expert_name,
    s.instrument,
    s.action,
    s.quantity,
    s.quantity_unit,
    s.created_at,
    now() - s.created_at AS age
  FROM expert_signals s
  JOIN experts e ON e.id = s.expert_id
  WHERE s.status = 'pending'
    AND s.created_at < now() - interval '7 days'
    AND s.action <> 'teaching'
)
SELECT expert_slug, expert_name, instrument, action, quantity, quantity_unit,
       to_char(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') AS created_tpe,
       date_trunc('day', age)::text AS age
FROM orphan
ORDER BY created_at;

\echo
\echo '### 2. UNIT_MIX — 同一 (expert, symbol) 在 trade_records + published expert_signals 出現多種 unit'
WITH sig_units AS (
  SELECT s.expert_id,
         regexp_replace(s.instrument, '\s.*$', '')                     AS symbol,
         s.instrument,
         s.quantity_unit                                                AS unit
  FROM expert_signals s
  WHERE s.status = 'published' AND s.action <> 'teaching' AND s.quantity IS NOT NULL AND s.quantity <> 0
),
tr_units AS (
  SELECT t.expert_id,
         regexp_replace(t.instrument, '\s.*$', '')                     AS symbol,
         t.instrument,
         t.quantity_unit                                                AS unit
  FROM trade_records t
),
all_units AS (
  SELECT expert_id, symbol, unit FROM sig_units
  UNION ALL
  SELECT expert_id, symbol, unit FROM tr_units
)
SELECT e.slug AS expert_slug, e.name AS expert_name, u.symbol,
       string_agg(DISTINCT u.unit, ' | ' ORDER BY u.unit) AS units_seen,
       count(DISTINCT u.unit) AS unit_variants
FROM all_units u
JOIN experts e ON e.id = u.expert_id
GROUP BY e.slug, e.name, u.symbol
HAVING count(DISTINCT u.unit) > 1
ORDER BY e.slug, u.symbol;

\echo
\echo '### 3. DRIFT_A_vs_B — 帳本 open 股數 ≠ 已發布訊號淨股數（含 add/trim/exit）'
WITH sig_norm AS (
  SELECT
    s.expert_id,
    regexp_replace(s.instrument, '\s.*$', '') AS symbol,
    s.action,
    (s.quantity * CASE WHEN s.quantity_unit = '張' THEN 1000 ELSE 1 END) AS shares
  FROM expert_signals s
  WHERE s.status = 'published' AND s.quantity IS NOT NULL
    AND s.action IN ('buy','add','sell','trim','exit')
),
sig_agg AS (
  SELECT expert_id, symbol,
    SUM(CASE WHEN action IN ('buy','add')          THEN shares ELSE 0 END) AS buy_shares,
    SUM(CASE WHEN action IN ('sell','trim','exit') THEN shares ELSE 0 END) AS sell_shares
  FROM sig_norm GROUP BY expert_id, symbol
),
tr_norm AS (
  SELECT
    t.expert_id,
    regexp_replace(t.instrument, '\s.*$', '') AS symbol,
    (t.quantity * CASE WHEN t.quantity_unit = '張' THEN 1000 ELSE 1 END) AS shares,
    t.status
  FROM trade_records t
),
tr_open AS (
  SELECT expert_id, symbol, SUM(shares) AS open_shares
  FROM tr_norm WHERE status = 'open'
  GROUP BY expert_id, symbol
),
merged AS (
  SELECT COALESCE(s.expert_id, o.expert_id) AS expert_id,
         COALESCE(s.symbol,    o.symbol)    AS symbol,
         COALESCE(s.buy_shares, 0)   AS b_buy,
         COALESCE(s.sell_shares, 0)  AS b_sell,
         COALESCE(s.buy_shares, 0) - COALESCE(s.sell_shares, 0) AS b_net,
         COALESCE(o.open_shares, 0)  AS a_open
  FROM sig_agg s
  FULL OUTER JOIN tr_open o USING (expert_id, symbol)
)
SELECT e.slug AS expert_slug, e.name AS expert_name, m.symbol,
       m.a_open, m.b_net, m.b_buy, m.b_sell,
       (m.a_open - m.b_net) AS drift_shares
FROM merged m
JOIN experts e ON e.id = m.expert_id
WHERE (m.a_open - m.b_net) <> 0
ORDER BY abs(m.a_open - m.b_net) DESC, e.slug, m.symbol;

\echo
\echo '### 4. HIDDEN_ACTIONS — 訊號含 add/trim/exit 且淨股數 ≠ 0 → 週記「本週總計」與帳本會差'
WITH sig_norm AS (
  SELECT s.expert_id,
         regexp_replace(s.instrument, '\s.*$', '') AS symbol,
         s.action,
         (s.quantity * CASE WHEN s.quantity_unit = '張' THEN 1000 ELSE 1 END) AS shares
  FROM expert_signals s
  WHERE s.status = 'published' AND s.quantity IS NOT NULL
    AND s.action IN ('add','trim','exit')
)
SELECT e.slug AS expert_slug, e.name AS expert_name, n.symbol,
       SUM(CASE WHEN action='add'  THEN shares ELSE 0 END) AS add_shares,
       SUM(CASE WHEN action='trim' THEN shares ELSE 0 END) AS trim_shares,
       SUM(CASE WHEN action='exit' THEN shares ELSE 0 END) AS exit_shares,
       SUM(CASE WHEN action='add' THEN shares ELSE -shares END) AS hidden_net_shares
FROM sig_norm n
JOIN experts e ON e.id = n.expert_id
GROUP BY e.slug, e.name, n.symbol
HAVING SUM(CASE WHEN action='add' THEN shares ELSE -shares END) <> 0
ORDER BY abs(SUM(CASE WHEN action='add' THEN shares ELSE -shares END)) DESC;

\echo
\echo '### 5. UNIT_A_NE_B — 同 (expert, symbol) trade_records 的 unit 與 published signal 的 unit 不同（單位錯登）'
WITH sig_units AS (
  SELECT DISTINCT s.expert_id,
         regexp_replace(s.instrument, '\s.*$', '') AS symbol,
         s.quantity_unit AS sig_unit
  FROM expert_signals s
  WHERE s.status = 'published' AND s.action <> 'teaching' AND s.quantity IS NOT NULL AND s.quantity <> 0
),
tr_units AS (
  SELECT DISTINCT t.expert_id,
         regexp_replace(t.instrument, '\s.*$', '') AS symbol,
         t.quantity_unit AS tr_unit
  FROM trade_records t
)
SELECT e.slug AS expert_slug, e.name AS expert_name, s.symbol,
       string_agg(DISTINCT s.sig_unit, ',' ORDER BY s.sig_unit) AS signal_units,
       string_agg(DISTINCT t.tr_unit,  ',' ORDER BY t.tr_unit)  AS trade_units
FROM sig_units s
JOIN tr_units  t USING (expert_id, symbol)
JOIN experts   e ON e.id = s.expert_id
GROUP BY e.slug, e.name, s.symbol
HAVING string_agg(DISTINCT s.sig_unit, ',' ORDER BY s.sig_unit)
    <> string_agg(DISTINCT t.tr_unit,  ',' ORDER BY t.tr_unit)
ORDER BY e.slug, s.symbol;

\echo
\echo '### 6. ORPHAN_TRADE — trade_records 有 open，但該 (expert, symbol) 已發布訊號中無任何 buy/add'
WITH sig_buy AS (
  SELECT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
  FROM expert_signals
  WHERE status='published' AND action IN ('buy','add')
),
tr_open AS (
  SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
  FROM trade_records WHERE status='open'
)
SELECT e.slug AS expert_slug, e.name AS expert_name, o.symbol
FROM tr_open o
JOIN experts e ON e.id = o.expert_id
LEFT JOIN sig_buy b USING (expert_id, symbol)
WHERE b.symbol IS NULL
ORDER BY e.slug, o.symbol;

\echo
\echo '### 7. ORPHAN_SIGNAL — expert_signals 有 buy/add，但 (expert, symbol) 在 trade_records 完全不存在'
WITH sig_buy AS (
  SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
  FROM expert_signals WHERE status='published' AND action IN ('buy','add')
),
tr_any AS (
  SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
  FROM trade_records
)
SELECT e.slug AS expert_slug, e.name AS expert_name, s.symbol
FROM sig_buy s
JOIN experts e ON e.id = s.expert_id
LEFT JOIN tr_any t USING (expert_id, symbol)
WHERE t.symbol IS NULL
ORDER BY e.slug, s.symbol;
