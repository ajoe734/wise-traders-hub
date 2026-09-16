-- P0_UNPUBLISHED_JOURNAL_EDIT_ISOLATION_V1
--
-- 狀態：**尚未套用（NOT APPLIED）**。本輪明確禁止 apply migration，
-- 因此此檔暫存於 db/ 之下；核准後再由 migration 工具套用（原文照搬即可）。
--
-- 未發布（pending）週記的「內容版本更新」專用 RPC。
--
-- 為什麼要獨立一支：`save_signal_batch(_is_editing => true)` 在編輯時會
--   DELETE trade_records / expert_signal_legs / expert_signals 再重新 INSERT，
-- 而 expert_signals 的 AFTER INSERT trigger `handle_signal_trade()` 會重建帳本，
-- BEFORE INSERT trigger `enforce_signal_capital_limit()` 會用「現在」的可用現金
-- 重新檢核歷史週記。結果是：老師只想改標題或參考價，卻連動既有部位／可用資金，
-- 甚至被 CAPITAL_EXCEEDED 擋住而完全無法儲存。
--
-- 本函式改為「就地 UPDATE」：
--   * status / batch_id / created_at / published_at 一律不動
--   * 因為 status 沒有改變，`handle_signal_trade()` 會在 `OLD.status = NEW.status`
--     的分支立刻 RETURN，完全不碰 trade_records
--   * 因為 OLD.status IN ('pending','published')，`enforce_signal_capital_limit()`
--     也會在 UPDATE 分支立刻 RETURN，不做可用現金檢核
--     （單位／資產類別相容性檢查仍會生效，這是刻意保留的）
--   * 不 DELETE 任何 row，所以不會觸發 legs / trade_records 的連鎖刪除
--
-- 因此：positions / capital / available_cash / 已實現損益 / 績效 全部維持不變。
--
-- fail closed 錯誤碼：
--   unauthenticated / forbidden / not_mentor / batch_mismatch /
--   not_pending / empty_rows / row_set_change_unsupported

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

  -- 授權：company_admin 或該 expert 的擁有者
  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = _expert_id AND e.user_id = _caller)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- 只有週記老師（mentor）適用；advisor 訊號維持原流程
  SELECT e.role::text INTO _role FROM public.experts e WHERE e.id = _expert_id;
  IF _role IS DISTINCT FROM 'mentor' THEN
    RAISE EXCEPTION 'not_mentor' USING ERRCODE = '42501';
  END IF;

  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN
    RAISE EXCEPTION 'empty_rows' USING ERRCODE = '22023';
  END IF;

  -- 鎖住整批，避免併發時狀態在檢核後被改掉
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

  -- 整批都必須還是 pending；已公開的週記不得走這條路徑重寫歷史
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

  -- 內容更新不得增刪交易列：新增／刪除會動到 trade_records 與資金帳本。
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
