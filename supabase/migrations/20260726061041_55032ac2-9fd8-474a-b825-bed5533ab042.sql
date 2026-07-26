
CREATE OR REPLACE FUNCTION public.backfill_legacy_bsr_to_fact(_from date, _to date)
RETURNS TABLE(inserted_rows integer, skipped_rows integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_total int := 0;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Invalid date range: % to %', _from, _to;
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.tw_bsr_daily
  WHERE trade_date BETWEEN _from AND _to;

  PERFORM set_config('app.force_reseal', 'true', true);

  WITH ins AS (
    INSERT INTO public.tw_chip_fact (
      stock_id, trade_date, broker_id, broker_name, source,
      buy_shares, sell_shares,
      avg_buy_price, avg_sell_price, ingested_at
    )
    SELECT
      stock_id, trade_date, broker_id, broker_name,
      'legacy_migration'::text,
      buy_shares, sell_shares,
      avg_buy_price, avg_sell_price,
      COALESCE(created_at, now())
    FROM public.tw_bsr_daily
    WHERE trade_date BETWEEN _from AND _to
    ON CONFLICT (stock_id, trade_date, broker_id, source) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  PERFORM set_config('app.force_reseal', 'false', true);

  RETURN QUERY SELECT v_inserted, GREATEST(v_total - v_inserted, 0);
END;
$$;
