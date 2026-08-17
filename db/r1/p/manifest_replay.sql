-- =====================================================================
-- R1-P — machine-readable replay manifest (84 keys) + drift manifest.
-- SOURCE OF TRUTH: live production, READ-ONLY. No DDL, no DML.
-- Emits ONE json column `manifest` (array of key objects). PII-free:
--   * expert_id is replaced by a stable salted-free md5 handle `E-xxxxxxxx`
--   * no names, slugs, emails, reason texts or user ids are emitted
-- Classification is identical to R0 E_replay/E_classify so the counts
-- reconcile exactly: 84 = 48 match + 17 multiple_apply + 9 signal_only
--                        + 6 stored_only + 3 incomplete + 1 other.
-- =====================================================================
WITH ev AS (
  SELECT s.id, s.expert_id, s.instrument, s.market, s.action::text AS action,
         s.quantity, coalesce(s.quantity_unit,'-') AS unit,
         s.price_hint, coalesce(s.is_combo,false) AS is_combo,
         coalesce(s.executed_at, s.published_at, s.created_at) AS at
  FROM public.expert_signals s
  WHERE s.status = 'published' AND s.action::text <> 'teaching'
), norm AS (
  SELECT *,
    CASE WHEN market='TW' AND unit='張' THEN quantity*1000
         WHEN market='TW' AND unit='股' THEN quantity
         WHEN market='US' THEN quantity
         ELSE NULL END AS shares,
    CASE WHEN action IN ('buy','add') THEN 1
         WHEN action IN ('sell','trim','exit') THEN -1 ELSE 0 END AS dir,
    (quantity IS NULL OR price_hint IS NULL OR unit='-' OR is_combo) AS bad
  FROM ev
), replay AS (
  SELECT expert_id, market, instrument,
         bool_or(bad) AS incomplete,
         bool_or(is_combo) AS any_combo,
         bool_or(price_hint IS NULL) AS any_missing_price,
         bool_or(quantity IS NULL) AS any_missing_qty,
         bool_or(unit='-') AS any_missing_unit,
         count(*) AS n_events,
         count(DISTINCT unit) AS n_units_sig,
         sum(CASE WHEN action='exit' THEN 0 ELSE dir*coalesce(shares,0) END) AS net_shares,
         bool_or(action='exit') AS has_exit
  FROM norm GROUP BY 1,2,3
), stored AS (
  SELECT t.expert_id, t.market, t.instrument,
    sum(CASE WHEN t.status='open' THEN
      CASE WHEN t.market='TW' AND t.quantity_unit='張' THEN t.quantity*1000 ELSE t.quantity END
      ELSE 0 END) AS open_shares,
    sum(CASE WHEN t.status<>'open' THEN
      CASE WHEN t.market='TW' AND t.quantity_unit='張' THEN t.quantity*1000 ELSE t.quantity END
      ELSE 0 END) AS closed_shares,
    count(*) FILTER (WHERE t.status='open')  AS open_rows,
    count(*) FILTER (WHERE t.status<>'open') AS closed_rows,
    count(DISTINCT coalesce(t.quantity_unit,'-')) AS n_units_tr,
    count(DISTINCT coalesce(t.currency,'-'))      AS n_cur_tr,
    count(DISTINCT t.signal_id) FILTER (WHERE t.signal_id IS NOT NULL) AS n_src_signals
  FROM public.trade_records t GROUP BY 1,2,3
), j AS (
  SELECT coalesce(r.expert_id, s.expert_id)   AS expert_id,
         coalesce(r.market,   s.market)       AS market,
         coalesce(r.instrument, s.instrument) AS instrument,
         coalesce(r.n_events,0) AS events,
         coalesce(r.incomplete,false) AS incomplete,
         coalesce(r.any_combo,false) AS any_combo,
         coalesce(r.any_missing_price,false) AS any_missing_price,
         coalesce(r.any_missing_qty,false)   AS any_missing_qty,
         coalesce(r.any_missing_unit,false)  AS any_missing_unit,
         coalesce(r.has_exit,false) AS has_exit,
         r.net_shares,
         coalesce(r.n_units_sig,0) AS n_units_sig,
         coalesce(s.open_shares,0)  AS stored_open,
         coalesce(s.closed_shares,0) AS stored_closed,
         coalesce(s.open_rows,0)    AS open_rows,
         coalesce(s.closed_rows,0)  AS closed_rows,
         coalesce(s.n_units_tr,0)   AS n_units_tr,
         coalesce(s.n_cur_tr,0)     AS n_cur_tr,
         coalesce(s.n_src_signals,0) AS n_src_signals
  FROM replay r
  FULL JOIN stored s
    ON s.expert_id = r.expert_id
   AND s.market IS NOT DISTINCT FROM r.market
   AND s.instrument = r.instrument
), shape AS (
  -- shape ambiguity is evaluated per (expert, instrument) across markets/units,
  -- exactly like R0 E_classify. unit_ambiguous and market_ambiguous OVERLAP.
  SELECT j.expert_id, j.instrument,
         count(DISTINCT j.market) AS n_markets,
         max(j.n_units_sig + j.n_units_tr) AS unit_variants,
         sum(j.n_units_sig) AS sig_units, sum(j.n_units_tr) AS tr_units
  FROM j GROUP BY 1,2
), cls AS (
  SELECT j.*,
    (SELECT n_markets FROM shape z WHERE z.expert_id=j.expert_id AND z.instrument=j.instrument) AS n_markets,
    CASE WHEN j.incomplete THEN 'incomplete'
         WHEN j.events = 0 THEN 'stored_only'
         WHEN j.open_rows = 0 AND j.closed_rows = 0 THEN 'signal_only'
         WHEN j.stored_open = CASE WHEN j.has_exit THEN 0 ELSE j.net_shares END THEN 'match'
         WHEN j.net_shares <> 0 AND j.stored_open % nullif(j.net_shares,0) = 0 THEN 'multiple_apply'
         ELSE 'other' END AS class,
    j.stored_open - CASE WHEN j.has_exit THEN 0 ELSE coalesce(j.net_shares,0) END AS qty_drift
  FROM j
), e AS (
  SELECT id, coalesce(currency,'-') AS currency, coalesce(asset_class,'-') AS asset_class FROM public.experts
), fx AS (
  SELECT count(*) AS n_rows,
         bool_or(true) FILTER (WHERE false) AS dated -- fx_rates has no as-of date column
  FROM public.fx_rates
), rows AS (
SELECT
  'K-' || left(md5(c.expert_id::text || '|' || coalesce(c.market,'-') || '|' || c.instrument), 16) AS key,
  'E-' || left(md5(c.expert_id::text), 8) AS expert,
  c.instrument, coalesce(c.market,'-') AS market,
  coalesce(e.currency,'-') AS currency, coalesce(e.asset_class,'-') AS asset_class,
  c.stored_open AS stored_open_qty_shares,
  c.stored_closed AS stored_closed_qty_shares,
  CASE WHEN c.incomplete THEN NULL
       WHEN c.has_exit THEN 0 ELSE c.net_shares END AS replay_qty_shares,
  c.qty_drift,
  c.class,
  c.events AS source_signal_count,
  c.open_rows + c.closed_rows AS source_effect_count,
  c.n_src_signals AS source_effect_linked_signals,
  (SELECT coalesce(json_agg(x ORDER BY x),'[]'::json) FROM (
     SELECT unnest(ARRAY[]::text[]) AS x
     UNION ALL SELECT 'combo_unsupported'   WHERE c.any_combo
     UNION ALL SELECT 'missing_price_hint'  WHERE c.any_missing_price
     UNION ALL SELECT 'missing_quantity'    WHERE c.any_missing_qty
     UNION ALL SELECT 'missing_quantity_unit' WHERE c.any_missing_unit
     UNION ALL SELECT 'unit_ambiguous'      WHERE (c.n_units_sig + c.n_units_tr) > 1
     UNION ALL SELECT 'market_ambiguous'    WHERE c.n_markets > 1
     UNION ALL SELECT 'multiple_apply_suspected' WHERE c.class='multiple_apply'
     UNION ALL SELECT 'projection_without_signal' WHERE c.class='stored_only'
     UNION ALL SELECT 'signal_without_projection' WHERE c.class='signal_only'
     UNION ALL SELECT 'unclassified_drift'  WHERE c.class='other'
     UNION ALL SELECT 'fx_history_unavailable'
        WHERE coalesce(e.currency,'-') <> 'TWD' AND (SELECT n_rows FROM fx) <= 1
  ) q) AS reason_codes,
  json_build_object(
    'unit_supported',   ((c.n_units_sig + c.n_units_tr) <= 1 AND NOT c.any_missing_unit),
    'market_supported', (c.n_markets <= 1 AND c.market IS NOT NULL),
    'price_supported',  (NOT c.any_missing_price),
    'derivative_supported', (NOT c.any_combo),
    'fx_supported',     (coalesce(e.currency,'-') = 'TWD' OR (SELECT n_rows FROM fx) > 1)
  ) AS supported,
  CASE WHEN c.class = 'match'
        AND (c.n_units_sig + c.n_units_tr) <= 1
        AND c.n_markets <= 1
        AND NOT c.any_combo AND NOT c.any_missing_price
       THEN 'auto_supported' ELSE 'manual_review' END AS review_status,
  CASE WHEN c.class = 'match'
        AND (c.n_units_sig + c.n_units_tr) <= 1
        AND c.n_markets <= 1
        AND NOT c.any_combo AND NOT c.any_missing_price
       THEN 'publishable' ELSE 'withheld_incomplete' END AS public_disposition
FROM cls c LEFT JOIN e ON e.id = c.expert_id
)
SELECT json_build_object(
  'generated_by','db/r1/p/manifest_replay.sql',
  'source','production read-only catalog+data',
  'total_keys',(SELECT count(*) FROM rows),
  'class_counts',(SELECT json_object_agg(class,n) FROM (SELECT class,count(*) n FROM rows GROUP BY 1) z),
  'reason_counts',(SELECT json_object_agg(rc,n) FROM (
      SELECT r2.rc, count(*) n FROM rows, json_array_elements_text(rows.reason_codes) r2(rc) GROUP BY 1) z2),
  'keys',(SELECT json_agg(rows ORDER BY class, market, instrument) FROM rows)
) AS manifest;
