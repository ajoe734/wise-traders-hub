CREATE OR REPLACE FUNCTION public.sample_redact_m1(_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  t  text;
  ry text;
BEGIN
  t := public.sample_normalize_text(coalesce(_text, ''));

  IF pg_catalog.btrim(t) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_source', 'text', '');
  END IF;

  IF t ~* '<\s*/?\s*[a-z!][^>]*>' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'html_residual', 'text', '');
  END IF;

  IF t ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_email', 'text', '');
  END IF;
  IF t ~ '(09[0-9]{8}|\+886[0-9]{6,}|0[2-8]-[0-9]{6,8})' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_phone', 'text', '');
  END IF;
  IF t ~* '(https?://|line\.me|t\.me|@[A-Za-z0-9_]{4,})' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_url_or_line', 'text', '');
  END IF;
  IF t ~ '[^[:ascii:]]{2,3}(老師|先生|小姐|總監|執行長)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_person_name', 'text', '');
  END IF;

  IF t ~ '(明天|明日|下週|下周|下個交易日|週一|周一|週五前|周五前|本週內|本周內|接下來|後續)[^。！!?？\n]{0,16}(買進|買好|買|賣出|賣|進場|出場|加碼|減碼|停利|停損|布局|佈局|卡位|準備|上攻|操作)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'future_instruction', 'text', '');
  END IF;
  IF t ~ '(一定要|務必|必須|建議|請|記得)[^。！!?？\n]{0,14}(買進|賣出|進場|出場|加碼|減碼|停利|停損|執行|布局|佈局|卡位|操作|抱住|追價)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'future_instruction', 'text', '');
  END IF;

  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*%', '［比例已隱藏］', 'g');
  t := regexp_replace(t, '(全倉|半倉|滿倉)', '［比例已隱藏］', 'g');
  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*(張|口|股|部位|單位|手)', '［數量已隱藏］', 'g');
  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*(元|塊|美元|美金|USD|usd|NT\$|\$)', '［價格已隱藏］', 'g');

  FOR i IN 1..4 LOOP
    t := regexp_replace(
      t,
      '(價位|成本|均價|報價|目標價|履約價|短履約價|長履約價|停損價|停利價|油價|本金|最大損失|支撐|壓力)([^0-9\n]{0,16})[0-9][0-9,]*(\.[0-9]+)?(\s*[~～至到-]\s*[0-9][0-9,]*(\.[0-9]+)?)?',
      '\1\2［價格已隱藏］',
      'g'
    );
  END LOOP;

  t := regexp_replace(
    t,
    '(跌破|站上|突破|逼近|回測|上看|下看|守住|失守|上|破|至|到)\s*[0-9][0-9,]*(\.[0-9]+)?(\s*[~～]\s*[0-9][0-9,]*(\.[0-9]+)?)?(?![0-9%年月日號檔家人次])',
    '\1［價格已隱藏］',
    'g'
  );

  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*[~～]\s*[0-9][0-9,]*(\.[0-9]+)?', '［價格已隱藏］', 'g');
  t := regexp_replace(t, '(?<![0-9])[0-9]+\.[0-9]+(?![0-9])', '［價格已隱藏］', 'g');

  ry := regexp_replace(t, '(19|20)[0-9]{2}\s*年?', '', 'g');
  IF ry ~ '[0-9]{4,}' OR ry ~ '[0-9],[0-9]{3}' OR t ~ '[0-9]+\.[0-9]' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unclassified_numeric', 'text', '');
  END IF;
  IF t ~ '(跌破|站上|突破|逼近|履約價|油價|本金|最大損失|目標價|均價|成本|價位|報價|支撐|壓力)[^。\n]{0,12}[0-9]' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'residual_contextual_price', 'text', '');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', null, 'text', t);
END;
$$;

REVOKE ALL ON FUNCTION public.sample_redact_m1(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sample_redact_m1(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_redact_m1(text) TO service_role;