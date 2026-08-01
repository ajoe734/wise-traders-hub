CREATE OR REPLACE FUNCTION public.rebuild_bsr_rollup(_as_of date, _stock_ids text[] DEFAULT NULL, _max_stocks int DEFAULT 400)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sid text; v_rows int := 0; v_stocks int := 0;
  v_dates date[]; v_win int; v_use date[]; v_src date;
  v_top_buy jsonb; v_top_sell jsonb; v_conc numeric; v_broker_count int;
BEGIN
  FOR v_sid IN
    SELECT DISTINCT stock_id FROM public.tw_bsr_daily
     WHERE trade_date = _as_of
       AND (_stock_ids IS NULL OR stock_id = ANY(_stock_ids))
     ORDER BY stock_id
     LIMIT _max_stocks
  LOOP
    v_stocks := v_stocks + 1;
    SELECT array_agg(d ORDER BY d DESC) INTO v_dates
      FROM (SELECT DISTINCT trade_date d FROM public.tw_bsr_daily
             WHERE stock_id = v_sid AND trade_date <= _as_of
               AND trade_date >= _as_of - 90) t;
    IF v_dates IS NULL THEN CONTINUE; END IF;

    SELECT COUNT(DISTINCT broker_id) INTO v_broker_count
      FROM public.tw_bsr_daily WHERE stock_id = v_sid AND trade_date = _as_of;

    FOREACH v_win IN ARRAY ARRAY[1,5,10,20,60] LOOP
      v_use := v_dates[1:LEAST(v_win, array_length(v_dates,1))];
      v_src := v_use[1];

      WITH agg AS (
        SELECT broker_id,
               COALESCE(MAX(NULLIF(TRIM(broker_name),'')), '券商分點 ' || broker_id) AS nm,
               SUM(COALESCE(net_shares,0))::bigint AS net,
               SUM(COALESCE(buy_shares,0))::bigint AS buy
          FROM public.tw_bsr_daily
         WHERE stock_id = v_sid AND trade_date = ANY(v_use)
         GROUP BY broker_id
      )
      SELECT
        (SELECT jsonb_agg(jsonb_build_object('broker_id',broker_id,'name',nm,'net',net))
           FROM (SELECT * FROM agg ORDER BY net DESC LIMIT 3) x),
        (SELECT jsonb_agg(jsonb_build_object('broker_id',broker_id,'name',nm,'net',net))
           FROM (SELECT * FROM agg ORDER BY net ASC LIMIT 3) y),
        CASE WHEN (SELECT SUM(buy) FROM agg) > 0
             THEN ROUND((SELECT SUM(buy) FROM (SELECT buy FROM agg ORDER BY buy DESC LIMIT 15) z)::numeric
                        / (SELECT SUM(buy) FROM agg)::numeric * 100, 2)
             ELSE NULL END
      INTO v_top_buy, v_top_sell, v_conc;

      IF v_top_buy IS NULL THEN CONTINUE; END IF;

      INSERT INTO public.tw_chips_rollup
        (stock_id, as_of_date, window_days, source_date, fallback_used,
         foreign_net, trust_net, dealer_net, top_buy_brokers, top_sell_brokers,
         concentration_ratio, bsr_available, broker_count, low_quality, updated_at)
      VALUES (v_sid, _as_of, v_win, v_src, v_src < _as_of,
              0, 0, 0, v_top_buy, v_top_sell,
              v_conc, true,
              CASE WHEN v_win = 5 THEN v_broker_count ELSE NULL END,
              CASE WHEN v_win = 5 THEN (v_broker_count > 0 AND v_broker_count < 5) ELSE NULL END,
              now())
      ON CONFLICT (stock_id, as_of_date, window_days) DO UPDATE
        SET source_date = EXCLUDED.source_date,
            fallback_used = EXCLUDED.fallback_used,
            top_buy_brokers = EXCLUDED.top_buy_brokers,
            top_sell_brokers = EXCLUDED.top_sell_brokers,
            concentration_ratio = EXCLUDED.concentration_ratio,
            bsr_available = true,
            broker_count = COALESCE(EXCLUDED.broker_count, public.tw_chips_rollup.broker_count),
            low_quality = COALESCE(EXCLUDED.low_quality, public.tw_chips_rollup.low_quality),
            updated_at = now();
      v_rows := v_rows + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('as_of', _as_of, 'stocks', v_stocks, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_bsr_rollup(date, text[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_bsr_rollup(date, text[], int) TO service_role;