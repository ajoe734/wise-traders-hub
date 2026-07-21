
-- ============================================================
-- holdings_fix_proposals table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.holdings_fix_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drift_category text NOT NULL,
  expert_id uuid REFERENCES public.experts(id) ON DELETE CASCADE,
  expert_slug text,
  expert_name text,
  symbol text,
  instrument text,
  severity text NOT NULL DEFAULT 'medium',
  summary text NOT NULL,
  proposed_action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  signature text NOT NULL,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  applied_by uuid,
  applied_at timestamptz,
  apply_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holdings_fix_proposals_status_chk CHECK (status IN ('pending','applied','rejected','superseded','failed')),
  CONSTRAINT holdings_fix_proposals_action_chk CHECK (proposed_action IN (
    'normalize_unit','adjust_trade_quantity','close_trade_record',
    'create_trade_record','delete_orphan_signal','cancel_signal','manual_review'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS holdings_fix_proposals_signature_uidx
  ON public.holdings_fix_proposals(signature);
CREATE INDEX IF NOT EXISTS holdings_fix_proposals_status_idx
  ON public.holdings_fix_proposals(status, drift_category);
CREATE INDEX IF NOT EXISTS holdings_fix_proposals_expert_idx
  ON public.holdings_fix_proposals(expert_id);

GRANT SELECT, INSERT, UPDATE ON public.holdings_fix_proposals TO authenticated;
GRANT ALL ON public.holdings_fix_proposals TO service_role;

ALTER TABLE public.holdings_fix_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can view fix proposals"
  ON public.holdings_fix_proposals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "Company admins can insert fix proposals"
  ON public.holdings_fix_proposals FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "Company admins can update fix proposals"
  ON public.holdings_fix_proposals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.tg_holdings_fix_proposals_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS holdings_fix_proposals_updated_at ON public.holdings_fix_proposals;
CREATE TRIGGER holdings_fix_proposals_updated_at
  BEFORE UPDATE ON public.holdings_fix_proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_holdings_fix_proposals_updated_at();

-- audit trail on the proposals table itself
DROP TRIGGER IF EXISTS audit_holdings_fix_proposals ON public.holdings_fix_proposals;
CREATE TRIGGER audit_holdings_fix_proposals
  AFTER INSERT OR UPDATE OR DELETE ON public.holdings_fix_proposals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ============================================================
-- RPC: admin_generate_fix_proposals
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_generate_fix_proposals(p_category text DEFAULT NULL)
RETURNS TABLE(inserted integer, superseded integer, total_pending integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted int := 0;
  v_superseded int := 0;
  v_total int := 0;
  r record;
  v_sig text;
  v_action text;
  v_payload jsonb;
  v_preview jsonb;
  v_summary text;
  v_expert_id uuid;
  v_canon_unit text;
  v_signal_ids uuid[];
  v_trade_id uuid;
  v_trade_qty numeric;
  v_trade_unit text;
BEGIN
  IF NOT public.has_role(v_uid, 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Supersede pending proposals so we start clean per generation
  UPDATE public.holdings_fix_proposals
     SET status = 'superseded', reviewed_by = v_uid, reviewed_at = now(),
         review_note = 'auto-superseded by regeneration'
   WHERE status = 'pending'
     AND (p_category IS NULL OR drift_category = p_category);
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  FOR r IN
    SELECT * FROM public.admin_holdings_consistency_audit()
     WHERE (p_category IS NULL OR category = p_category)
  LOOP
    SELECT id INTO v_expert_id FROM public.experts WHERE slug = r.expert_slug;

    v_action := NULL; v_payload := '{}'::jsonb; v_preview := '{}'::jsonb; v_summary := '';

    IF r.category IN ('UNIT_MIX') THEN
      -- canonical unit = latest trade_records unit for this expert+symbol; fallback to latest signal unit
      SELECT t.quantity_unit INTO v_canon_unit
        FROM public.trade_records t
       WHERE t.expert_id = v_expert_id
         AND regexp_replace(t.instrument, '\s.*$', '') = r.symbol
       ORDER BY t.created_at DESC LIMIT 1;
      IF v_canon_unit IS NULL THEN
        SELECT s.quantity_unit INTO v_canon_unit
          FROM public.expert_signals s
         WHERE s.expert_id = v_expert_id
           AND regexp_replace(s.instrument, '\s.*$', '') = r.symbol
         ORDER BY s.created_at DESC LIMIT 1;
      END IF;

      SELECT array_agg(s.id) INTO v_signal_ids
        FROM public.expert_signals s
       WHERE s.expert_id = v_expert_id
         AND regexp_replace(s.instrument, '\s.*$', '') = r.symbol
         AND s.quantity_unit IS DISTINCT FROM v_canon_unit;

      IF v_canon_unit IS NULL OR v_signal_ids IS NULL OR array_length(v_signal_ids,1) IS NULL THEN
        v_action := 'manual_review';
        v_summary := format('%s：偵測到單位混用但無法自動決定 canonical 單位', r.symbol);
      ELSE
        v_action := 'normalize_unit';
        v_summary := format('%s：將 %s 筆訊號單位改寫為「%s」（依最新持倉）', r.symbol, array_length(v_signal_ids,1), v_canon_unit);
        v_payload := jsonb_build_object(
          'target_unit', v_canon_unit,
          'signal_ids', to_jsonb(v_signal_ids),
          'also_scale_quantity', false
        );
        v_preview := jsonb_build_object(
          'units_seen', r.details->>'units_seen',
          'target_unit', v_canon_unit,
          'affected_signal_count', array_length(v_signal_ids,1)
        );
      END IF;

    ELSIF r.category = 'DRIFT_A_VS_B' THEN
      SELECT t.id, t.quantity, t.quantity_unit INTO v_trade_id, v_trade_qty, v_trade_unit
        FROM public.trade_records t
       WHERE t.expert_id = v_expert_id
         AND regexp_replace(t.instrument, '\s.*$', '') = r.symbol
         AND t.status = 'open'
       ORDER BY t.created_at DESC LIMIT 1;
      IF v_trade_id IS NULL THEN
        v_action := 'manual_review';
        v_summary := format('%s：帳面部位與訊號淨額不符，且找不到 open 部位', r.symbol);
      ELSE
        DECLARE
          v_net_shares numeric := (r.details->>'signal_net_shares')::numeric;
          v_target_qty numeric;
        BEGIN
          v_target_qty := CASE WHEN v_trade_unit = '張' THEN v_net_shares / 1000.0 ELSE v_net_shares END;
          v_action := 'adjust_trade_quantity';
          v_summary := format('%s：持倉 %s %s → 建議 %s %s（比對訊號淨額）', r.symbol, v_trade_qty, v_trade_unit, v_target_qty, v_trade_unit);
          v_payload := jsonb_build_object(
            'trade_id', v_trade_id,
            'from_quantity', v_trade_qty,
            'to_quantity', v_target_qty,
            'unit', v_trade_unit
          );
          v_preview := jsonb_build_object(
            'before', jsonb_build_object('quantity', v_trade_qty, 'unit', v_trade_unit),
            'after', jsonb_build_object('quantity', v_target_qty, 'unit', v_trade_unit),
            'signal_net_shares', v_net_shares
          );
        END;
      END IF;

    ELSIF r.category = 'ORPHAN_PENDING' THEN
      v_action := 'cancel_signal';
      v_summary := format('%s：pending 訊號超過 %s 天，建議刪除', r.symbol, r.details->>'age_days');
      v_payload := jsonb_build_object('signal_id', r.details->>'signal_id');
      v_preview := jsonb_build_object('signal', r.details);

    ELSIF r.category = 'ORPHAN_TRADE' THEN
      SELECT t.id, t.quantity, t.quantity_unit INTO v_trade_id, v_trade_qty, v_trade_unit
        FROM public.trade_records t
       WHERE t.expert_id = v_expert_id
         AND regexp_replace(t.instrument, '\s.*$', '') = r.symbol
         AND t.status = 'open'
       ORDER BY t.created_at DESC LIMIT 1;
      IF v_trade_id IS NULL THEN
        v_action := 'manual_review';
        v_summary := format('%s：找不到對應的 open 部位可平倉', r.symbol);
      ELSE
        v_action := 'close_trade_record';
        v_summary := format('%s：訊號已賣光，建議將持倉標記為 closed', r.symbol);
        v_payload := jsonb_build_object('trade_id', v_trade_id);
        v_preview := jsonb_build_object('before_status', 'open', 'after_status', 'closed', 'quantity', v_trade_qty, 'unit', v_trade_unit);
      END IF;

    ELSE
      -- UNIT_A_NE_B / HIDDEN_ACTIONS / ORPHAN_SIGNAL and others
      v_action := 'manual_review';
      v_summary := format('%s：%s 需人工判斷', COALESCE(r.symbol, r.expert_slug), r.category);
      v_preview := r.details;
    END IF;

    v_sig := r.category || '|' || COALESCE(r.expert_slug,'-') || '|' || COALESCE(r.symbol,'-')
             || '|' || md5(v_payload::text);

    INSERT INTO public.holdings_fix_proposals(
      drift_category, expert_id, expert_slug, expert_name, symbol, instrument,
      severity, summary, proposed_action, payload, preview, status, signature,
      generated_by
    ) VALUES (
      r.category, v_expert_id, r.expert_slug, r.expert_name, r.symbol, r.symbol,
      r.severity, v_summary, v_action, v_payload, v_preview, 'pending', v_sig,
      v_uid
    )
    ON CONFLICT (signature) DO UPDATE
      SET status = 'pending',
          summary = EXCLUDED.summary,
          payload = EXCLUDED.payload,
          preview = EXCLUDED.preview,
          severity = EXCLUDED.severity,
          generated_by = v_uid,
          generated_at = now(),
          reviewed_by = NULL,
          reviewed_at = NULL,
          review_note = NULL,
          applied_by = NULL,
          applied_at = NULL,
          apply_result = NULL;
    v_inserted := v_inserted + 1;
  END LOOP;

  SELECT count(*) INTO v_total FROM public.holdings_fix_proposals WHERE status = 'pending';

  INSERT INTO public.audit_logs(actor_id, action, target_type, detail)
  VALUES (v_uid, 'fix_proposals.generate', 'holdings_fix_proposals',
          jsonb_build_object('inserted', v_inserted, 'superseded', v_superseded, 'category', p_category));

  RETURN QUERY SELECT v_inserted, v_superseded, v_total;
END $$;

REVOKE ALL ON FUNCTION public.admin_generate_fix_proposals(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_generate_fix_proposals(text) TO authenticated;

-- ============================================================
-- RPC: admin_apply_fix_proposal
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_apply_fix_proposal(p_id uuid, p_confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prop public.holdings_fix_proposals;
  v_result jsonb := '{}'::jsonb;
  v_ids uuid[];
BEGIN
  IF NOT public.has_role(v_uid, 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'confirmation required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.holdings_fix_proposals WHERE id = p_id FOR UPDATE;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found';
  END IF;
  IF v_prop.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal is not pending (status=%)', v_prop.status;
  END IF;

  BEGIN
    IF v_prop.proposed_action = 'normalize_unit' THEN
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_prop.payload->'signal_ids'))::uuid[] INTO v_ids;
      UPDATE public.expert_signals
         SET quantity_unit = v_prop.payload->>'target_unit'
       WHERE id = ANY(v_ids);
      v_result := jsonb_build_object('updated_signals', array_length(v_ids,1));

    ELSIF v_prop.proposed_action = 'adjust_trade_quantity' THEN
      UPDATE public.trade_records
         SET quantity = (v_prop.payload->>'to_quantity')::numeric
       WHERE id = (v_prop.payload->>'trade_id')::uuid;
      v_result := jsonb_build_object('updated_trade_id', v_prop.payload->>'trade_id');

    ELSIF v_prop.proposed_action = 'close_trade_record' THEN
      UPDATE public.trade_records
         SET status = 'closed', exit_date = COALESCE(exit_date, now())
       WHERE id = (v_prop.payload->>'trade_id')::uuid;
      v_result := jsonb_build_object('closed_trade_id', v_prop.payload->>'trade_id');

    ELSIF v_prop.proposed_action = 'cancel_signal' THEN
      DELETE FROM public.expert_signals
       WHERE id = (v_prop.payload->>'signal_id')::uuid
         AND status = 'pending';
      v_result := jsonb_build_object('deleted_signal_id', v_prop.payload->>'signal_id');

    ELSIF v_prop.proposed_action = 'manual_review' THEN
      RAISE EXCEPTION 'this proposal requires manual handling and cannot be auto-applied';
    ELSE
      RAISE EXCEPTION 'unsupported proposed_action %', v_prop.proposed_action;
    END IF;

    UPDATE public.holdings_fix_proposals
       SET status = 'applied',
           applied_by = v_uid,
           applied_at = now(),
           apply_result = v_result
     WHERE id = p_id;

    INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
    VALUES (v_uid, 'fix_proposal.apply', 'holdings_fix_proposals', p_id,
            jsonb_build_object('action', v_prop.proposed_action, 'payload', v_prop.payload, 'result', v_result));

  EXCEPTION WHEN OTHERS THEN
    UPDATE public.holdings_fix_proposals
       SET status = 'failed',
           applied_by = v_uid,
           applied_at = now(),
           apply_result = jsonb_build_object('error', SQLERRM)
     WHERE id = p_id;
    RAISE;
  END;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_apply_fix_proposal(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_fix_proposal(uuid, boolean) TO authenticated;

-- ============================================================
-- RPC: admin_reject_fix_proposal
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_reject_fix_proposal(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.holdings_fix_proposals
     SET status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = p_note
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal not found or not pending'; END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
  VALUES (v_uid, 'fix_proposal.reject', 'holdings_fix_proposals', p_id,
          jsonb_build_object('note', p_note));
END $$;

REVOKE ALL ON FUNCTION public.admin_reject_fix_proposal(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reject_fix_proposal(uuid, text) TO authenticated;
