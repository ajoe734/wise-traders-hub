\i db/r1/p/instrument_class_view.sql

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
