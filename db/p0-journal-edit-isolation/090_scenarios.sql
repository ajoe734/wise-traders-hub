-- P0_UNPUBLISHED_JOURNAL_EDIT_ISOLATION_V1 — disposable ledger-isolation scenarios
--
-- 執行方式：整份丟給 run_sql（不含 \i，可直接執行）。最後的 DO block 一定會
-- RAISE EXCEPTION 把報告吐出來，因此整個 transaction 必定 ROLLBACK：**零 production mutation**。
--
-- Fingerprint 覆蓋（存在的表/視圖）：
--   trade_records（權威交易帳本）、user_performances（績效/已實現）、
--   v_active_tw_holdings（全域 active symbol view，僅有 stock_id 一欄，無 expert_id，
--     不可 per-expert 查詢；僅做全域 before/after hash）、experts.starting_capital（資金基準）、
--   expert_signals meta（id/batch_id/status/created_at/published_at）
-- NOT PRESENT：沒有 per-expert positions 表、沒有 capital/cash ledger 表、沒有 realized_pnl 表
--   （available_cash 由 starting_capital + trade_records 推導）。
--
-- 下方 CREATE OR REPLACE FUNCTION 為 supabase/migrations/20260916093500_update_pending_mentor_journal_batch.sql
-- 的逐字內聯（僅去除註解），語意完全相同。

BEGIN;

CREATE OR REPLACE FUNCTION public.update_pending_mentor_journal_batch(
  _expert_id uuid,
  _batch_id uuid,
  _rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _updated integer := 0;
  _existing_ids uuid[];
  _payload_ids uuid[];
  _role text;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = _expert_id AND e.user_id = _caller)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT e.role::text INTO _role FROM public.experts e WHERE e.id = _expert_id;
  IF _role IS DISTINCT FROM 'mentor' THEN
    RAISE EXCEPTION 'not_mentor' USING ERRCODE = '42501';
  END IF;

  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN
    RAISE EXCEPTION 'empty_rows' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(t.id ORDER BY t.id) INTO _existing_ids
  FROM (
    SELECT es.id
    FROM public.expert_signals es
    WHERE es.batch_id = _batch_id AND es.expert_id = _expert_id
    FOR UPDATE
  ) t;

  IF _existing_ids IS NULL OR array_length(_existing_ids, 1) = 0 THEN
    RAISE EXCEPTION 'batch_mismatch' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expert_signals es
    WHERE es.batch_id = _batch_id AND es.expert_id = _expert_id
      AND es.status <> 'pending'::signal_status
  ) THEN
    RAISE EXCEPTION 'not_pending' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(x.id ORDER BY x.id) INTO _payload_ids
  FROM jsonb_to_recordset(_rows) AS x(id uuid);

  IF _payload_ids IS NULL OR array_position(_payload_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'row_set_change_unsupported' USING ERRCODE = '22023';
  END IF;

  IF _existing_ids <> _payload_ids THEN
    RAISE EXCEPTION 'row_set_change_unsupported' USING ERRCODE = '22023';
  END IF;

  UPDATE public.expert_signals es
  SET
    instrument      = p.instrument,
    action          = p.action,
    price_hint      = p.price_hint,
    quantity        = p.quantity,
    quantity_unit   = p.quantity_unit,
    executed_at     = COALESCE(p.executed_at, es.executed_at),
    reason_summary  = p.reason_summary,
    reason_detail   = p.reason_detail,
    risk_notes      = p.risk_notes,
    teaching_topic  = p.teaching_topic,
    overall_summary = p.overall_summary,
    learning_points = p.learning_points
  FROM jsonb_to_recordset(_rows) AS p(
    id uuid,
    instrument text,
    action signal_action,
    price_hint numeric,
    quantity numeric,
    quantity_unit text,
    executed_at timestamptz,
    reason_summary text,
    reason_detail text,
    risk_notes text,
    teaching_topic text,
    overall_summary text,
    learning_points text
  )
  WHERE es.id = p.id
    AND es.batch_id = _batch_id
    AND es.expert_id = _expert_id
    AND es.status = 'pending'::signal_status;

  GET DIAGNOSTICS _updated = ROW_COUNT;

  IF _updated <> array_length(_existing_ids, 1) THEN
    RAISE EXCEPTION 'batch_mismatch' USING ERRCODE = '22023';
  END IF;

  RETURN _updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_pending_mentor_journal_batch(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pending_mentor_journal_batch(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pending_mentor_journal_batch(uuid, uuid, jsonb) TO service_role;

CREATE FUNCTION pg_temp.fp() RETURNS text LANGUAGE sql AS $fp$
  SELECT format(
    'trade_records=%s/%s | user_performances=%s/%s | v_active_tw_holdings=%s/%s | experts_capital=%s/%s',
    (SELECT count(*) FROM public.trade_records),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM public.trade_records t),
    (SELECT count(*) FROM public.user_performances),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM public.user_performances t),
    (SELECT count(*) FROM public.v_active_tw_holdings),
    (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM public.v_active_tw_holdings t),
    (SELECT count(*) FROM public.experts),
    (SELECT md5(coalesce(string_agg(e.id::text || ':' || coalesce(e.starting_capital::text, 'null'), '|' ORDER BY e.id), '')) FROM public.experts e)
  );
$fp$;

CREATE FUNCTION pg_temp.meta_fp(_batch uuid) RETURNS text LANGUAGE sql AS $mf$
  SELECT md5(coalesce(string_agg(
    es.id::text || ':' || coalesce(es.batch_id::text,'-') || ':' || es.status::text || ':' ||
    es.created_at::text || ':' || coalesce(es.published_at::text,'-') || ':' || es.expert_id::text,
    '|' ORDER BY es.id), ''))
  FROM public.expert_signals es WHERE es.batch_id = _batch;
$mf$;

CREATE FUNCTION pg_temp.mk_rows(_batch uuid, _expert uuid, _topic text, _price numeric,
                                _limit int DEFAULT NULL, _null_row int DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $mk$
  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id,
    'instrument', CASE WHEN _null_row IS NOT NULL AND s.rn = _null_row THEN NULL ELSE s.instrument END,
    'action', s.action,
    'price_hint', _price,
    'quantity', s.quantity,
    'quantity_unit', s.quantity_unit,
    'executed_at', s.executed_at,
    'reason_summary', s.reason_summary,
    'reason_detail', s.reason_detail,
    'risk_notes', s.risk_notes,
    'teaching_topic', _topic,
    'overall_summary', s.overall_summary,
    'learning_points', s.learning_points
  ) ORDER BY s.id)
  FROM (
    SELECT es.*, row_number() OVER (ORDER BY es.id) rn
    FROM public.expert_signals es
    WHERE es.batch_id = _batch AND es.expert_id = _expert
  ) s
  WHERE _limit IS NULL OR s.rn <= _limit;
$mk$;

DO $do$
DECLARE
  rep text := '';
  fp0 text; fp1 text;
  m0 text; m1 text;
  n int;
  err text;
  admin_uid  uuid := 'e237e66c-932d-4e69-9f84-26cb296861f6';
  sharkgu    uuid := '13926bcc-d3df-4ef5-bc56-7181ae4302a2';
  sharkgu_u  uuid := '2a49b906-0b5f-4de7-b94f-92baa384a16e';
  zhou       uuid := '890db218-aeff-49c9-890c-cc016db09673';
  zhou_u     uuid := '1d2c9c82-6008-477f-851e-25c6abee05a9';
  brcto      uuid := '3fda8093-81b1-43ed-ac4f-8936e0a7a8f2';
  brcto_b    uuid := '35aa2cc9-41b5-4e36-acb9-5b7dd6a9b91b';
  sk_batch   uuid := '50df8c5d-1104-470d-9402-535def796356';
  zhou_batch uuid := '01f2f640-d74c-432d-b7bb-f2908f63ee69';
  pub_batch  uuid := 'f6f3918a-9cfa-4147-8684-f783d050f177';
  advisor    uuid := 'a1000000-0000-0000-0000-000000000001';
  advisor_u  uuid := '891e87f5-9afa-4e69-8236-00e3c9595e89';
  fresh_b    uuid := gen_random_uuid();
  fresh_s    uuid := gen_random_uuid();
  brcto_u    uuid;
  tv text; pv numeric;
  hold_cnt int;
  after_topics text := '';
BEGIN
  SELECT user_id INTO brcto_u FROM public.experts WHERE id = brcto;

  rep := rep || E'FP_START: ' || pg_temp.fp() || E'\n';

  -- S1 owner pending mentor：teaching_topic + price_hint 更新成功
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(sk_batch);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sharkgu_u, 'role','authenticated')::text, true);
  SELECT public.update_pending_mentor_journal_batch(sharkgu, sk_batch,
         pg_temp.mk_rows(sk_batch, sharkgu, 'S1_TOPIC', 111.5)) INTO n;
  SELECT max(teaching_topic), max(price_hint) INTO tv, pv
    FROM public.expert_signals WHERE batch_id = sk_batch;
  fp1 := pg_temp.fp(); m1 := pg_temp.meta_fp(sk_batch);
  rep := rep || format(E'S1 owner_success updated=%s topic=%s price=%s ledger_same=%s meta_same=%s\n',
    n, tv, pv, fp0 = fp1, m0 = m1);
  rep := rep || format(E'   S1 fp_before=%s\n   S1 fp_after =%s\n', md5(fp0), md5(fp1));

  -- S2 available_cash=0、無現持倉：沿用既有 sharkgu expert（不新建 expert，避免 slug 保護 trigger）
  --    setup：starting_capital=0 + 刪除該 expert 的 trade_records（本 transaction 內，最終 rollback）
  --    fp0 在 setup 之後取得 → 驗證的是「RPC 前後」帳本不變
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role','authenticated')::text, true);
  UPDATE public.experts SET starting_capital = 0 WHERE id = sharkgu;
  DELETE FROM public.trade_records WHERE expert_id = sharkgu;
  INSERT INTO public.expert_signals (id, expert_id, batch_id, instrument, action, market, status, price_hint, quantity, quantity_unit, teaching_topic, executed_at)
  VALUES (fresh_s, sharkgu, fresh_b, '2330', 'teaching', 'tw_stock', 'pending', 10, 1, '張', 'S2_BEFORE', now());
  -- 此 schema 無 per-expert positions 表；v_active_tw_holdings 是全域 stock_id projection
  -- （只有 stock_id 一欄），無法 per-expert 查詢。改以「該 expert 交易數=0」作為
  -- 無交易／無可推導持倉的 setup 證據；全域 view 仍由 pg_temp.fp() 做 before/after hash。
  SELECT count(*) INTO hold_cnt FROM public.trade_records WHERE expert_id = sharkgu;
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(fresh_b);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sharkgu_u, 'role','authenticated')::text, true);
  SELECT public.update_pending_mentor_journal_batch(sharkgu, fresh_b,
         pg_temp.mk_rows(fresh_b, sharkgu, 'S2_TOPIC', 222.5)) INTO n;
  SELECT max(teaching_topic), max(price_hint) INTO tv, pv FROM public.expert_signals WHERE batch_id = fresh_b;
  fp1 := pg_temp.fp(); m1 := pg_temp.meta_fp(fresh_b);
  rep := rep || format(E'S2 cash0_no_holdings updated=%s topic=%s price=%s trade_records_for_expert=%s ledger_same=%s meta_same=%s\n',
    n, tv, pv, hold_cnt, fp0 = fp1, m0 = m1);
  rep := rep || format(E'   S2 fp_before=%s\n   S2 fp_after =%s\n', md5(fp0), md5(fp1));

  -- S3 company_admin 成功
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(zhou_batch);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role','authenticated')::text, true);
  SELECT public.update_pending_mentor_journal_batch(zhou, zhou_batch,
         pg_temp.mk_rows(zhou_batch, zhou, 'S3_TOPIC', 333.5)) INTO n;
  SELECT max(teaching_topic) INTO tv FROM public.expert_signals WHERE batch_id = zhou_batch;
  fp1 := pg_temp.fp(); m1 := pg_temp.meta_fp(zhou_batch);
  rep := rep || format(E'S3 admin_success updated=%s topic=%s ledger_same=%s meta_same=%s\n', n, tv, fp0 = fp1, m0 = m1);
  rep := rep || format(E'   S3 fp_before=%s\n   S3 fp_after =%s\n', md5(fp0), md5(fp1));

  -- S4 anonymous
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(sk_batch); err := 'NO_ERROR';
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM public.update_pending_mentor_journal_batch(sharkgu, sk_batch, pg_temp.mk_rows(sk_batch, sharkgu, 'HACK', 9));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S4 anonymous err=%s ledger_same=%s meta_same=%s fp=%s\n', err, fp0 = fp1, m0 = pg_temp.meta_fp(sk_batch), md5(fp1));

  -- S5 另一位老師
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(sk_batch); err := 'NO_ERROR';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', zhou_u, 'role','authenticated')::text, true);
    PERFORM public.update_pending_mentor_journal_batch(sharkgu, sk_batch, pg_temp.mk_rows(sk_batch, sharkgu, 'HACK', 9));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S5 cross_tenant err=%s ledger_same=%s meta_same=%s fp=%s\n', err, fp0 = fp1, m0 = pg_temp.meta_fp(sk_batch), md5(fp1));

  -- S6 錯 expert/batch 對應
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(zhou_batch); err := 'NO_ERROR';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', sharkgu_u, 'role','authenticated')::text, true);
    PERFORM public.update_pending_mentor_journal_batch(sharkgu, zhou_batch, pg_temp.mk_rows(zhou_batch, zhou, 'HACK', 9));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S6 batch_expert_mismatch err=%s ledger_same=%s meta_same=%s fp=%s\n', err, fp0 = fp1, m0 = pg_temp.meta_fp(zhou_batch), md5(fp1));

  -- S7 advisor
  fp0 := pg_temp.fp(); err := 'NO_ERROR';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', advisor_u, 'role','authenticated')::text, true);
    PERFORM public.update_pending_mentor_journal_batch(advisor, sk_batch, pg_temp.mk_rows(sk_batch, sharkgu, 'HACK', 9));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S7 advisor err=%s ledger_same=%s fp=%s\n', err, fp0 = fp1, md5(fp1));

  -- S8 published batch
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(pub_batch); err := 'NO_ERROR';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', sharkgu_u, 'role','authenticated')::text, true);
    PERFORM public.update_pending_mentor_journal_batch(sharkgu, pub_batch, pg_temp.mk_rows(pub_batch, sharkgu, 'HACK', 9));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S8 published err=%s ledger_same=%s meta_same=%s fp=%s\n', err, fp0 = fp1, m0 = pg_temp.meta_fp(pub_batch), md5(fp1));

  -- S9 mixed status
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role','authenticated')::text, true);
  UPDATE public.expert_signals SET status = 'published'
   WHERE id = (SELECT id FROM public.expert_signals WHERE batch_id = brcto_b ORDER BY id LIMIT 1);
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(brcto_b); err := 'NO_ERROR';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', brcto_u, 'role','authenticated')::text, true);
    PERFORM public.update_pending_mentor_journal_batch(brcto, brcto_b, pg_temp.mk_rows(brcto_b, brcto, 'HACK', 9));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S9 mixed_status err=%s ledger_same=%s meta_same=%s fp=%s\n', err, fp0 = fp1, m0 = pg_temp.meta_fp(brcto_b), md5(fp1));
  UPDATE public.expert_signals SET status = 'pending' WHERE batch_id = brcto_b;

  -- S10 empty rows
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(brcto_b); err := 'NO_ERROR';
  BEGIN
    PERFORM public.update_pending_mentor_journal_batch(brcto, brcto_b, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S10 empty_rows err=%s ledger_same=%s meta_same=%s fp=%s\n', err, fp0 = fp1, m0 = pg_temp.meta_fp(brcto_b), md5(fp1));

  -- S11 row-set change
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(brcto_b); err := 'NO_ERROR';
  BEGIN
    PERFORM public.update_pending_mentor_journal_batch(brcto, brcto_b, pg_temp.mk_rows(brcto_b, brcto, 'HACK', 9, 1));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S11 row_set_change err=%s ledger_same=%s meta_same=%s fp=%s\n', err, fp0 = fp1, m0 = pg_temp.meta_fp(brcto_b), md5(fp1));

  -- S12 中途錯誤（第 2 列 instrument = NULL）→ 整批 rollback
  fp0 := pg_temp.fp(); m0 := pg_temp.meta_fp(brcto_b); err := 'NO_ERROR';
  SELECT md5(string_agg(coalesce(teaching_topic,'-') || coalesce(price_hint::text,'-'), '|' ORDER BY id))
    INTO tv FROM public.expert_signals WHERE batch_id = brcto_b;
  BEGIN
    PERFORM public.update_pending_mentor_journal_batch(brcto, brcto_b, pg_temp.mk_rows(brcto_b, brcto, 'S12_HALF', 777, NULL, 2));
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  SELECT md5(string_agg(coalesce(teaching_topic,'-') || coalesce(price_hint::text,'-'), '|' ORDER BY id))
    INTO after_topics FROM public.expert_signals WHERE batch_id = brcto_b;
  fp1 := pg_temp.fp();
  rep := rep || format(E'S12 partial_failure err=%s content_unchanged=%s ledger_same=%s meta_same=%s fp=%s\n',
    err, tv = after_topics, fp0 = fp1, m0 = pg_temp.meta_fp(brcto_b), md5(fp1));

  rep := rep || E'FP_END:   ' || pg_temp.fp() || E'\n';
  rep := rep || E'NOT PRESENT: positions table, capital/cash ledger table, realized_pnl table (derived from experts.starting_capital + trade_records)\n';

  RAISE EXCEPTION E'\n===P0_SCENARIO_REPORT===\n%===END===', rep;
END
$do$;

ROLLBACK;
