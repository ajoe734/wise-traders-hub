-- =====================================================================
-- R1-P — instrument classification from PRODUCTION SECURITY MASTER ONLY.
-- READ-ONLY. No DDL, no DML.
--
-- Authority order (names are NEVER used to classify):
--   1. public.warrant_expiry        -- TWSE/TPEx warrant security master
--                                      (symbol, exercise_ratio, call_put, expire_date)
--   2. trade_records / expert_signals structural flags
--                                      (is_combo, combo_strategy, quantity_unit='組')
--   3. TWSE code space (structural identifier rule, not a name guess):
--        4 digits            -> listed equity
--        00xx / 00xxx[A-Z]   -> ETF
--        6 digits, not 00xx  -> call/put warrant code space
--   4. public.current_prices / public.stock_names give a QUOTE only.
--      Their `asset_class` column defaults to 'tw_stock' and is therefore
--      NOT authoritative -- it is never read for classification.
--
-- Fail-closed: a TW 6-digit code that is absent from the warrant master is
-- `unknown_derivative` (derivative_supported=false, price/NAV/return NULL).
-- =====================================================================
CREATE OR REPLACE VIEW pg_temp.instrument_class_v AS
WITH universe AS (
  SELECT expert_id, market, instrument,
         bool_or(coalesce(is_combo,false))            AS any_combo,
         bool_or(combo_strategy IS NOT NULL)          AS any_combo_strategy,
         bool_or(coalesce(quantity_unit,'-') = '組')  AS any_lot_unit
    FROM (
      SELECT expert_id, market, instrument, is_combo, combo_strategy, quantity_unit
        FROM public.trade_records
      UNION ALL
      SELECT expert_id, market, instrument, is_combo, combo_strategy, quantity_unit
        FROM public.expert_signals
        WHERE status='published' AND action::text <> 'teaching'
    ) u
   GROUP BY 1,2,3
), code AS (
  SELECT u.*, split_part(u.instrument,' ',1) AS sym FROM universe u
), m AS (
  SELECT c.*,
         w.symbol         AS w_symbol,
         w.exercise_ratio AS w_ratio,
         w.call_put       AS w_call_put,
         w.expire_date    AS w_expire,
         p.price          AS quote_price,
         p.updated_at     AS quote_at
    FROM code c
    LEFT JOIN public.warrant_expiry w ON w.symbol = c.sym
    LEFT JOIN public.current_prices p ON p.symbol = c.sym
)
SELECT
  m.expert_id, m.market, m.instrument, m.sym,
  CASE
    WHEN m.market='US' AND (m.any_combo OR m.any_combo_strategy OR m.any_lot_unit)
         THEN 'us_option_combo'
    WHEN m.market='TW' AND m.w_symbol IS NOT NULL              THEN 'tw_warrant'
    WHEN m.market='TW' AND m.sym ~ '^[0-9]{6}$'
         AND left(m.sym,2) <> '00'                             THEN 'unknown_derivative'
    WHEN m.market='TW' AND (m.sym ~ '^[0-9]{4}$'
         OR m.sym ~ '^00[0-9]{2,3}[A-Z]?$')                    THEN 'tw_stock'
    WHEN m.market='US' AND m.sym ~ '^[A-Z][A-Z.\-]{0,5}$'      THEN 'us_stock'
    ELSE 'unknown_instrument'
  END AS asset_class,
  (m.any_combo OR m.any_combo_strategy OR m.any_lot_unit) AS combo_shaped,
  m.w_symbol IS NOT NULL                                  AS in_warrant_master,
  m.w_ratio  AS exercise_ratio, m.w_call_put AS call_put, m.w_expire AS expire_date,
  m.quote_price, m.quote_at,
  -- derivatives are supported only with a complete quote AND multiplier chain
  CASE
    WHEN m.market='US' AND (m.any_combo OR m.any_combo_strategy OR m.any_lot_unit)
         THEN false                                   -- no per-leg quote, no contract multiplier
    WHEN m.market='TW' AND m.w_symbol IS NOT NULL
         THEN (m.w_ratio IS NOT NULL AND m.quote_price IS NOT NULL)
    WHEN m.market='TW' AND m.sym ~ '^[0-9]{6}$' AND left(m.sym,2) <> '00'
         THEN false                                   -- unknown_derivative -> fail closed
    ELSE true                                         -- cash equity: not a derivative
  END AS derivative_supported,
  CASE
    WHEN m.market='US' AND (m.any_combo OR m.any_combo_strategy OR m.any_lot_unit)
         THEN 'combo_no_leg_quote_no_multiplier'
    WHEN m.market='TW' AND m.w_symbol IS NOT NULL AND m.w_ratio IS NULL
         THEN 'warrant_master_hit_ratio_missing'
    WHEN m.market='TW' AND m.w_symbol IS NOT NULL AND m.quote_price IS NULL
         THEN 'warrant_master_hit_quote_missing'
    WHEN m.market='TW' AND m.w_symbol IS NOT NULL
         THEN 'warrant_master_hit_complete'
    WHEN m.market='TW' AND m.sym ~ '^[0-9]{6}$' AND left(m.sym,2) <> '00'
         THEN 'warrant_code_space_absent_from_master'
    ELSE 'cash_equity'
  END AS classification_evidence
FROM m;

SELECT json_build_object(
  'generated_by','db/r1/p/instrument_class.sql',
  'authority', json_build_array('public.warrant_expiry',
                                'trade_records.is_combo/combo_strategy/quantity_unit',
                                'expert_signals.is_combo/combo_strategy/quantity_unit',
                                'TWSE code space'),
  'non_authoritative', json_build_array('current_prices.asset_class','stock_names.asset_class',
                                        'instrument display name'),
  'class_counts',(SELECT json_object_agg(asset_class,n) FROM
      (SELECT asset_class,count(*) n FROM pg_temp.instrument_class_v GROUP BY 1) z),
  'instruments',(SELECT json_agg(json_build_object(
      'key','K-'||left(md5(x.expert_id::text||'|'||coalesce(x.market,'-')||'|'||x.instrument),16),
      'expert','E-'||left(md5(x.expert_id::text),8),
      'market',x.market,'instrument',x.instrument,'symbol',x.sym,
      'asset_class',x.asset_class,'in_warrant_master',x.in_warrant_master,
      'exercise_ratio',x.exercise_ratio,'call_put',x.call_put,'expire_date',x.expire_date,
      'quote_price',x.quote_price,'derivative_supported',x.derivative_supported,
      'classification_evidence',x.classification_evidence)
      ORDER BY x.asset_class, x.market, x.instrument) FROM pg_temp.instrument_class_v x)
) AS instrument_class;
