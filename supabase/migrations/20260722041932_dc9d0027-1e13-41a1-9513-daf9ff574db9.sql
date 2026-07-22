
CREATE OR REPLACE FUNCTION public.log_unit_lock_violation(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_audit_id       uuid;
  v_alert_id       uuid;
  v_expert_id      uuid;
  v_symbol         text;
  v_existing_id    uuid;
  v_actor          uuid;
  v_expert_name    text;
BEGIN
  IF payload IS NULL THEN
    RETURN NULL;
  END IF;

  v_expert_id := NULLIF(payload->>'expert_id','')::uuid;
  v_symbol    := NULLIF(payload->>'symbol','');
  BEGIN
    v_existing_id := NULLIF(payload->>'existing_row_id','')::uuid;
  EXCEPTION WHEN others THEN
    v_existing_id := NULL;
  END;

  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN others THEN
    v_actor := NULL;
  END;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
  VALUES (
    v_actor,
    'unit_lock_blocked',
    COALESCE(payload->>'existing_source', 'expert_signals'),
    v_existing_id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'expert_id',       v_expert_id,
        'symbol',          v_symbol,
        'existing_source', payload->>'existing_source',
        'existing_row_id', payload->>'existing_row_id',
        'existing_unit',   payload->>'existing_unit',
        'existing_quantity', payload->>'existing_quantity',
        'attempted_unit',  payload->>'attempted_unit',
        'asset_class',     payload->>'asset_class',
        'allowed_units',   payload->>'allowed_units',
        'signal_id',       payload->>'signal_id',
        'attempted_row_id',payload->>'attempted_row_id',
        'caller',          payload->>'caller',
        'raw_message',     payload->>'raw_message',
        'raw_hint',        payload->>'raw_hint',
        'raw_code',        payload->>'raw_code'
      )
    )
  )
  RETURNING id INTO v_audit_id;

  IF v_expert_id IS NOT NULL THEN
    SELECT name INTO v_expert_name FROM public.experts WHERE id = v_expert_id;
  END IF;

  -- 24h 內同分析師+同代碼合併：找開啟中的最近一筆，若無則新建
  SELECT id INTO v_alert_id
  FROM public.system_alerts
  WHERE kind = 'unit_lock_blocked'
    AND resolved_at IS NULL
    AND fired_at >= now() - interval '24 hours'
    AND detail->>'expert_id' IS NOT DISTINCT FROM v_expert_id::text
    AND detail->>'symbol' IS NOT DISTINCT FROM v_symbol
  ORDER BY fired_at DESC
  LIMIT 1;

  IF v_alert_id IS NULL THEN
    INSERT INTO public.system_alerts (kind, level, title, message, detail)
    VALUES (
      'unit_lock_blocked',
      'warning',
      format('單位鎖擋下寫入：%s / %s',
             COALESCE(v_expert_name, v_expert_id::text, '未知分析師'),
             COALESCE(v_symbol, '未知代碼')),
      format('欲寫入單位「%s」但已存在「%s」未平倉部位（%s#%s）。允許單位：%s。',
             COALESCE(payload->>'attempted_unit','?'),
             COALESCE(payload->>'existing_unit','?'),
             COALESCE(payload->>'existing_source','?'),
             COALESCE(payload->>'existing_row_id','?'),
             COALESCE(payload->>'allowed_units','?')),
      jsonb_build_object(
        'expert_id',      v_expert_id,
        'expert_name',    v_expert_name,
        'symbol',         v_symbol,
        'hits',           1,
        'first_audit_id', v_audit_id,
        'last_audit_id',  v_audit_id,
        'attempted_unit', payload->>'attempted_unit',
        'existing_unit',  payload->>'existing_unit',
        'existing_source',payload->>'existing_source',
        'existing_row_id',payload->>'existing_row_id',
        'asset_class',    payload->>'asset_class',
        'allowed_units',  payload->>'allowed_units'
      )
    );
  ELSE
    UPDATE public.system_alerts
    SET detail = detail
                 || jsonb_build_object(
                      'hits',          COALESCE((detail->>'hits')::int, 0) + 1,
                      'last_audit_id', v_audit_id,
                      'attempted_unit',payload->>'attempted_unit',
                      'existing_unit', payload->>'existing_unit',
                      'existing_source',payload->>'existing_source',
                      'existing_row_id',payload->>'existing_row_id'
                    ),
        fired_at = now()
    WHERE id = v_alert_id;
  END IF;

  RETURN v_audit_id;
EXCEPTION WHEN others THEN
  -- 審計失敗絕不影響呼叫端流程
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_unit_lock_violation(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_unit_lock_violation(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.log_unit_lock_violation(jsonb) IS
  '呼叫端在 catch check_violation / UNIT_LOCK 後呼叫；用新交易寫入 audit_logs 與合併中的 system_alerts（trigger 內因會被 rollback 無法直接記錄）。';
