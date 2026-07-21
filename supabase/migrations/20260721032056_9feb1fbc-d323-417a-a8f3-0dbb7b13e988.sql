
CREATE OR REPLACE FUNCTION public.admin_holdings_consistency_audit()
RETURNS TABLE(
  category text,
  expert_slug text,
  expert_name text,
  symbol text,
  severity text,
  details jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  -- 1. ORPHAN_PENDING
  SELECT
    'ORPHAN_PENDING'::text,
    e.slug, e.name,
    s.instrument,
    CASE WHEN s.created_at < now() - interval '30 days' THEN 'high' ELSE 'medium' END,
    jsonb_build_object(
      'signal_id', s.id,
      'action', s.action,
      'quantity', s.quantity,
      'unit', s.quantity_unit,
      'created_at', s.created_at,
      'age_days', extract(day from (now() - s.created_at))::int
    )
  FROM expert_signals s
  JOIN experts e ON e.id = s.expert_id
  WHERE s.status = 'pending'
    AND s.created_at < now() - interval '7 days'
    AND s.action <> 'teaching';

  RETURN QUERY
  -- 2. UNIT_MIX
  WITH sig_units AS (
    SELECT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.quantity_unit AS unit
    FROM expert_signals s
    WHERE s.status = 'published' AND s.action <> 'teaching' AND s.quantity IS NOT NULL AND s.quantity <> 0
  ),
  tr_units AS (
    SELECT t.expert_id,
           regexp_replace(t.instrument, '\s.*$', '') AS symbol,
           t.quantity_unit AS unit
    FROM trade_records t
  ),
  all_units AS (
    SELECT * FROM sig_units UNION ALL SELECT * FROM tr_units
  )
  SELECT
    'UNIT_MIX'::text,
    e.slug, e.name, u.symbol,
    'high'::text,
    jsonb_build_object(
      'units_seen', string_agg(DISTINCT u.unit, ' | ' ORDER BY u.unit),
      'variants', count(DISTINCT u.unit)
    )
  FROM all_units u
  JOIN experts e ON e.id = u.expert_id
  GROUP BY e.slug, e.name, u.symbol
  HAVING count(DISTINCT u.unit) > 1;

  RETURN QUERY
  -- 3. DRIFT_A_VS_B
  WITH sig_norm AS (
    SELECT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.action,
           (s.quantity * CASE WHEN s.quantity_unit = '張' THEN 1000 ELSE 1 END) AS shares
    FROM expert_signals s
    WHERE s.status='published' AND s.quantity IS NOT NULL
      AND s.action IN ('buy','add','sell','trim','exit')
  ),
  sig_agg AS (
    SELECT expert_id, symbol,
      SUM(CASE WHEN action IN ('buy','add') THEN shares ELSE 0 END) AS buy_shares,
      SUM(CASE WHEN action IN ('sell','trim','exit') THEN shares ELSE 0 END) AS sell_shares
    FROM sig_norm GROUP BY expert_id, symbol
  ),
  tr_open AS (
    SELECT t.expert_id,
           regexp_replace(t.instrument, '\s.*$', '') AS symbol,
           SUM(t.quantity * CASE WHEN t.quantity_unit='張' THEN 1000 ELSE 1 END) AS open_shares
    FROM trade_records t WHERE t.status='open'
    GROUP BY t.expert_id, symbol
  ),
  merged AS (
    SELECT COALESCE(s.expert_id, o.expert_id) AS expert_id,
           COALESCE(s.symbol, o.symbol) AS symbol,
           COALESCE(s.buy_shares,0) AS b_buy,
           COALESCE(s.sell_shares,0) AS b_sell,
           COALESCE(s.buy_shares,0)-COALESCE(s.sell_shares,0) AS b_net,
           COALESCE(o.open_shares,0) AS a_open
    FROM sig_agg s FULL OUTER JOIN tr_open o USING (expert_id, symbol)
  )
  SELECT
    'DRIFT_A_VS_B'::text,
    e.slug, e.name, m.symbol,
    CASE WHEN abs(m.a_open - m.b_net) >= 10000 THEN 'high'
         WHEN abs(m.a_open - m.b_net) >= 1000  THEN 'medium'
         ELSE 'low' END,
    jsonb_build_object(
      'trade_open_shares', m.a_open,
      'signal_net_shares', m.b_net,
      'signal_buy_shares', m.b_buy,
      'signal_sell_shares', m.b_sell,
      'drift_shares', m.a_open - m.b_net
    )
  FROM merged m
  JOIN experts e ON e.id = m.expert_id
  WHERE (m.a_open - m.b_net) <> 0;

  RETURN QUERY
  -- 4. HIDDEN_ACTIONS
  WITH sig_norm AS (
    SELECT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.action,
           (s.quantity * CASE WHEN s.quantity_unit='張' THEN 1000 ELSE 1 END) AS shares
    FROM expert_signals s
    WHERE s.status='published' AND s.quantity IS NOT NULL
      AND s.action IN ('add','trim','exit')
  )
  SELECT
    'HIDDEN_ACTIONS'::text,
    e.slug, e.name, n.symbol,
    'medium'::text,
    jsonb_build_object(
      'add_shares',  SUM(CASE WHEN action='add'  THEN shares ELSE 0 END),
      'trim_shares', SUM(CASE WHEN action='trim' THEN shares ELSE 0 END),
      'exit_shares', SUM(CASE WHEN action='exit' THEN shares ELSE 0 END),
      'hidden_net_shares', SUM(CASE WHEN action='add' THEN shares ELSE -shares END)
    )
  FROM sig_norm n
  JOIN experts e ON e.id = n.expert_id
  GROUP BY e.slug, e.name, n.symbol
  HAVING SUM(CASE WHEN action='add' THEN shares ELSE -shares END) <> 0;

  RETURN QUERY
  -- 5. UNIT_A_NE_B
  WITH sig_units AS (
    SELECT DISTINCT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.quantity_unit AS sig_unit
    FROM expert_signals s
    WHERE s.status='published' AND s.action <> 'teaching' AND s.quantity IS NOT NULL AND s.quantity <> 0
  ),
  tr_units AS (
    SELECT DISTINCT t.expert_id,
           regexp_replace(t.instrument, '\s.*$', '') AS symbol,
           t.quantity_unit AS tr_unit
    FROM trade_records t
  )
  SELECT
    'UNIT_A_NE_B'::text,
    e.slug, e.name, s.symbol,
    'high'::text,
    jsonb_build_object(
      'signal_units', string_agg(DISTINCT s.sig_unit, ',' ORDER BY s.sig_unit),
      'trade_units',  string_agg(DISTINCT t.tr_unit,  ',' ORDER BY t.tr_unit)
    )
  FROM sig_units s
  JOIN tr_units  t USING (expert_id, symbol)
  JOIN experts   e ON e.id = s.expert_id
  GROUP BY e.slug, e.name, s.symbol
  HAVING string_agg(DISTINCT s.sig_unit,',' ORDER BY s.sig_unit)
      <> string_agg(DISTINCT t.tr_unit, ',' ORDER BY t.tr_unit);

  RETURN QUERY
  -- 6. ORPHAN_TRADE
  WITH sig_buy AS (
    SELECT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM expert_signals WHERE status='published' AND action IN ('buy','add')
  ),
  tr_open AS (
    SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM trade_records WHERE status='open'
  )
  SELECT 'ORPHAN_TRADE'::text, e.slug, e.name, o.symbol, 'high'::text, '{}'::jsonb
  FROM tr_open o
  JOIN experts e ON e.id = o.expert_id
  LEFT JOIN sig_buy b USING (expert_id, symbol)
  WHERE b.symbol IS NULL;

  RETURN QUERY
  -- 7. ORPHAN_SIGNAL
  WITH sig_buy AS (
    SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM expert_signals WHERE status='published' AND action IN ('buy','add')
  ),
  tr_any AS (
    SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM trade_records
  )
  SELECT 'ORPHAN_SIGNAL'::text, e.slug, e.name, s.symbol, 'medium'::text, '{}'::jsonb
  FROM sig_buy s
  JOIN experts e ON e.id = s.expert_id
  LEFT JOIN tr_any t USING (expert_id, symbol)
  WHERE t.symbol IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_holdings_consistency_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_holdings_consistency_audit() TO authenticated;
