CREATE OR REPLACE FUNCTION public.compute_bsr_series_readiness(p_stock_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_threshold int := 1;
  v_low_quality int := 5;
  v_have5 int; v_have20 int; v_have60 int;
  v_have5_lowq int; v_have20_lowq int; v_have60_lowq int;
  v_earliest date; v_latest date; v_probe record;
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RETURN jsonb_build_object('error', 'invalid_stock_id');
  END IF;

  -- 效能：只掃 110 日視窗（最大視窗上限），否則每檔要掃該股全部歷史，
  -- converge 排程 40 檔就會 statement timeout。
  WITH per_day AS (
    SELECT trade_date, COUNT(DISTINCT broker_id) AS broker_count
      FROM public.tw_bsr_daily
     WHERE stock_id = p_stock_id
       AND trade_date >= v_today - INTERVAL '110 days'
     GROUP BY trade_date
  ), valid_days AS (
    SELECT trade_date, broker_count FROM per_day WHERE broker_count >= v_threshold
  ), windowed AS (
    SELECT trade_date, broker_count,
           trade_date >= v_today - INTERVAL '10 days'  AS in5,
           trade_date >= v_today - INTERVAL '40 days'  AS in20,
           true                                        AS in60
      FROM valid_days
  )
  SELECT COUNT(*) FILTER (WHERE in5), COUNT(*) FILTER (WHERE in20), COUNT(*) FILTER (WHERE in60),
         COUNT(*) FILTER (WHERE in5  AND broker_count < v_low_quality),
         COUNT(*) FILTER (WHERE in20 AND broker_count < v_low_quality),
         COUNT(*) FILTER (WHERE in60 AND broker_count < v_low_quality)
    INTO v_have5, v_have20, v_have60, v_have5_lowq, v_have20_lowq, v_have60_lowq
    FROM windowed;

  SELECT min(trade_date), max(trade_date) INTO v_earliest, v_latest
    FROM public.tw_bsr_daily WHERE stock_id = p_stock_id;

  SELECT * INTO v_probe FROM public.tw_bsr_upstream_probe WHERE stock_id = p_stock_id;

  RETURN jsonb_build_object(
    'stock_id', p_stock_id, 'today', v_today,
    'threshold', v_threshold, 'low_quality_threshold', v_low_quality,
    'have5', COALESCE(v_have5,0), 'have20', COALESCE(v_have20,0), 'have60', COALESCE(v_have60,0),
    'have5_low_quality', COALESCE(v_have5_lowq,0),
    'have20_low_quality', COALESCE(v_have20_lowq,0),
    'have60_low_quality', COALESCE(v_have60_lowq,0),
    'earliest_available', v_earliest, 'latest_available', v_latest,
    'exhausted', COALESCE(v_probe.exhausted,false), 'probed_back_to', v_probe.probed_back_to,
    'ready5', COALESCE(v_have5,0) >= 5,
    'ready20', COALESCE(v_have20,0) >= 20,
    'ready60', COALESCE(v_have60,0) >= 60
  );
END;
$function$;