CREATE OR REPLACE FUNCTION public.rebuild_bsr_rollup(p_stock_id text, p_as_of date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows int := 0;
  v_broker_count int := 0;
BEGIN
  SELECT COUNT(DISTINCT broker_id) INTO v_broker_count
    FROM public.tw_bsr_daily
   WHERE stock_id = p_stock_id AND trade_date = p_as_of;

  WITH dates AS (
    SELECT trade_date, row_number() OVER (ORDER BY trade_date DESC) AS rn
      FROM (
        SELECT DISTINCT trade_date
          FROM public.tw_bsr_daily
         WHERE stock_id = p_stock_id AND trade_date <= p_as_of
         ORDER BY trade_date DESC
         LIMIT 60
      ) d
  ),
  wins(w) AS (VALUES (1),(5),(10),(20),(60)),
  agg AS (
    SELECT w.w,
           b.broker_id,
           COALESCE(NULLIF(btrim(MAX(b.broker_name)), ''), '券商分點 ' || b.broker_id) AS name,
           SUM(COALESCE(b.net_shares,0))::numeric AS net,
           SUM(COALESCE(b.buy_shares,0))::numeric AS buy,
           MAX(d.rn) AS max_rn
      FROM wins w
      JOIN dates d ON d.rn <= w.w
      JOIN public.tw_bsr_daily b
        ON b.stock_id = p_stock_id AND b.trade_date = d.trade_date
     GROUP BY w.w, b.broker_id
  ),
  ranked AS (
    SELECT a.*,
           row_number() OVER (PARTITION BY w ORDER BY net DESC, broker_id) AS rb,
           row_number() OVER (PARTITION BY w ORDER BY net ASC, broker_id) AS rs,
           row_number() OVER (PARTITION BY w ORDER BY buy DESC, broker_id) AS rbuy
      FROM agg a
  ),
  per_win AS (
    SELECT w,
           (SELECT jsonb_agg(jsonb_build_object('broker_id', r2.broker_id, 'name', r2.name, 'net', r2.net) ORDER BY r2.net DESC, r2.broker_id)
              FROM ranked r2 WHERE r2.w = r.w AND r2.rb <= 3) AS top_buy,
           (SELECT jsonb_agg(jsonb_build_object('broker_id', r3.broker_id, 'name', r3.name, 'net', r3.net) ORDER BY r3.net ASC, r3.broker_id)
              FROM ranked r3 WHERE r3.w = r.w AND r3.rs <= 3) AS top_sell,
           (SELECT CASE WHEN SUM(r4.buy) > 0
                        THEN (SUM(r4.buy) FILTER (WHERE r4.rbuy <= 15) / SUM(r4.buy)) * 100
                        ELSE NULL END
              FROM ranked r4 WHERE r4.w = r.w) AS concentration_ratio,
           (SELECT MAX(d2.trade_date) FROM dates d2 WHERE d2.rn <= r.w) AS source_date
      FROM (SELECT DISTINCT w FROM ranked) r
  )
  INSERT INTO public.tw_chips_rollup AS t (
    stock_id, as_of_date, window_days, source_date, fallback_used,
    foreign_net, trust_net, dealer_net,
    top_buy_brokers, top_sell_brokers, concentration_ratio, bsr_available,
    broker_count, low_quality, updated_at
  )
  SELECT p_stock_id, p_as_of, p.w, p.source_date, (p.source_date IS DISTINCT FROM p_as_of),
         0, 0, 0,
         COALESCE(p.top_buy, '[]'::jsonb), COALESCE(p.top_sell, '[]'::jsonb),
         ROUND(p.concentration_ratio, 2), true,
         CASE WHEN p.w = 5 THEN v_broker_count ELSE NULL END,
         CASE WHEN p.w = 5 THEN (v_broker_count > 0 AND v_broker_count < 5) ELSE NULL END,
         now()
    FROM per_win p
  ON CONFLICT (stock_id, as_of_date, window_days) DO UPDATE
     SET source_date = EXCLUDED.source_date,
         fallback_used = EXCLUDED.fallback_used,
         top_buy_brokers = EXCLUDED.top_buy_brokers,
         top_sell_brokers = EXCLUDED.top_sell_brokers,
         concentration_ratio = EXCLUDED.concentration_ratio,
         bsr_available = true,
         broker_count = COALESCE(EXCLUDED.broker_count, t.broker_count),
         low_quality = COALESCE(EXCLUDED.low_quality, t.low_quality),
         updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rebuild_bsr_rollup_range(p_since date, p_until date, p_max_stocks integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sid text; v_d date; v_rows int := 0; v_pairs int := 0;
BEGIN
  FOR v_sid, v_d IN
    SELECT stock_id, trade_date
      FROM (SELECT DISTINCT stock_id, trade_date
              FROM public.tw_bsr_daily
             WHERE trade_date BETWEEN p_since AND p_until) x
     ORDER BY trade_date DESC, stock_id
     LIMIT p_max_stocks
  LOOP
    v_rows := v_rows + public.rebuild_bsr_rollup(v_sid, v_d);
    v_pairs := v_pairs + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'pairs', v_pairs, 'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.rebuild_bsr_rollup(text, date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_bsr_rollup_range(date, date, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_bsr_rollup(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_bsr_rollup_range(date, date, integer) TO service_role;