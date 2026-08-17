-- R0-E2: fail-closed classification of replay drift.
\pset pager off
WITH sig AS (
  SELECT expert_id, market, instrument, coalesce(quantity_unit,'-') unit, count(*) n
  FROM expert_signals WHERE status='published' AND action::text<>'teaching' GROUP BY 1,2,3,4),
tr AS (
  SELECT expert_id, market, instrument, quantity_unit unit, count(*) n FROM trade_records GROUP BY 1,2,3,4),
keys AS (
  SELECT expert_id, instrument FROM sig UNION SELECT expert_id, instrument FROM tr),
mk AS (
  SELECT k.expert_id, k.instrument,
    (SELECT count(DISTINCT market) FROM (SELECT market FROM sig s WHERE s.expert_id=k.expert_id AND s.instrument=k.instrument
       UNION SELECT market FROM tr t WHERE t.expert_id=k.expert_id AND t.instrument=k.instrument) m) AS n_markets,
    (SELECT count(DISTINCT unit) FROM (SELECT unit FROM sig s WHERE s.expert_id=k.expert_id AND s.instrument=k.instrument
       UNION SELECT unit FROM tr t WHERE t.expert_id=k.expert_id AND t.instrument=k.instrument) u) AS n_units
  FROM keys k)
SELECT CASE WHEN n_markets>1 AND n_units>1 THEN 'market+unit_ambiguous'
            WHEN n_markets>1 THEN 'market_ambiguous'
            WHEN n_units>1 THEN 'unit_ambiguous'
            ELSE 'consistent_shape' END AS shape_class,
       count(*) AS symbol_keys
FROM mk GROUP BY 1 ORDER BY 2 DESC;
