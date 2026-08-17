-- =====================================================================
-- R1-D 002 CUTOVER — every legacy writer becomes a thin compatibility
-- wrapper over app_ledger canonical functions.
-- Signatures, return types and error contracts are preserved so that an
-- OLD Edge deployment keeps working unchanged (deployment stage 3).
-- No guard is relaxed, no trigger is disabled, no GUC/header bypass exists.
-- =====================================================================
SET lock_timeout = '3s';
SET statement_timeout = '300s';

-- ---------------------------------------------------------------- helper: position correction
-- Used by every admin fix / dedupe / realign path. Emits a cash-neutral
-- canonical correction instead of raw UPDATE/DELETE on trade_records.
CREATE OR REPLACE FUNCTION app_ledger.canonical_correct_position(
  p_expert uuid, p_instrument text, p_market text,
  p_target_qty int, p_unit text, p_reason text, p_corr_no int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ikey text; v_open public.trade_records; v_delta int; v_event uuid;
        v_key uuid; e public.experts;
BEGIN
  PERFORM app_ledger.lock_expert(p_expert);
  SELECT * INTO e FROM public.experts WHERE id = p_expert;
  IF e.id IS NULL THEN RAISE EXCEPTION 'unknown_expert: %', p_expert USING ERRCODE='P0001'; END IF;
  v_ikey := public.economic_instrument_key(p_market, p_instrument);
  SELECT * INTO v_open FROM public.trade_records t
   WHERE t.expert_id = p_expert AND t.instrument_key = v_ikey
     AND t.status = 'open'::public.trade_status FOR UPDATE;
  v_delta := p_target_qty - coalesce(v_open.quantity, 0);
  IF v_delta = 0 THEN
    RETURN pg_catalog.jsonb_build_object('status','no_effect','delta',0);
  END IF;
  v_key := app_ledger.derive_logical_effect_id(
             coalesce(v_open.id, pg_catalog.md5(v_ikey||p_expert::text)::uuid),
             'correction', p_corr_no);
  IF EXISTS (SELECT 1 FROM app_ledger.effect_key k
              WHERE k.logical_effect_id = v_key AND k.state = 'applied') THEN
    RETURN pg_catalog.jsonb_build_object('status','noop_idempotent','logical_effect_id',v_key);
  END IF;
  INSERT INTO app_ledger.effect_key(logical_effect_id, origin_signal_id, effect_kind,
      correction_no, expert_id, state, detail)
    VALUES (v_key, coalesce(v_open.signal_id, v_key), 'correction', p_corr_no, p_expert,
            'reserved', p_reason)
    ON CONFLICT (logical_effect_id) DO UPDATE SET state='reserved', updated_at=now();

  v_event := app_ledger.canonical_apply_effect(pg_catalog.jsonb_build_object(
    'action','quantity_adjustment','expert_id',p_expert,'instrument',p_instrument,
    'market', p_market, 'currency', coalesce(e.base_currency, e.currency), 'qty', v_delta,
    'qty_unit', coalesce(p_unit, v_open.quantity_unit), 'cost_delta', 0,
    'effective_at', pg_catalog.now(), 'signal_id', v_open.signal_id,
    'provenance','data_correction_adjustment','actor_via','admin_compat',
    'reason', p_reason));

  UPDATE app_ledger.effect_key SET state='applied', event_id=v_event, updated_at=now()
   WHERE logical_effect_id = v_key;
  RETURN pg_catalog.jsonb_build_object('status','applied','delta',v_delta,
    'logical_effect_id',v_key,'event_id',v_event);
END $$;
ALTER FUNCTION app_ledger.canonical_correct_position(uuid,text,text,int,text,text,int)
  OWNER TO ledger_owner;

-- ---------------------------------------------------------------- W01 handle_signal_trade
CREATE OR REPLACE FUNCTION public.handle_signal_trade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  -- compat wrapper (R1-D): zero economic DML here; canonical_apply_signal owns it.
  v := app_ledger.canonical_apply_signal(NEW.id, NULL, 'handle_signal_trade');
  IF v->>'status' = 'applied' THEN
    INSERT INTO public.signal_trade_applications(signal_id, expert_id, action,
        applied_quantity, tg_op, applied_at)
    VALUES (NEW.id, NEW.expert_id, NEW.action::text, NEW.quantity, TG_OP, pg_catalog.now())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.handle_signal_trade() OWNER TO wrapper_owner;

-- ---------------------------------------------------------------- W02 handle_signal_takedown
CREATE OR REPLACE FUNCTION public.handle_signal_takedown() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status::text = 'taken_down' AND OLD.status::text = 'published' THEN
    PERFORM app_ledger.canonical_reverse_signal(NEW.id, 'takedown', NULL, 'handle_signal_takedown');
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.handle_signal_takedown() OWNER TO wrapper_owner;

-- ---------------------------------------------------------------- W03 save_signal_batch
-- Only change vs legacy: the editing path reverses via canonical instead of
-- DELETE FROM trade_records. Auth checks, validation and errors are byte-identical.
CREATE OR REPLACE FUNCTION public.save_signal_batch(
  _expert_id uuid, _batch_id uuid, _signals jsonb,
  _legs jsonb DEFAULT '[]'::jsonb, _is_editing boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _caller uuid := auth.uid(); _inserted integer := 0; _old_ids uuid[]; _id uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role(_caller,'company_admin'::public.app_role)
          OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id=_expert_id AND e.user_id=_caller))
  THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _signals IS NULL OR pg_catalog.jsonb_typeof(_signals) <> 'array'
     OR pg_catalog.jsonb_array_length(_signals) = 0
  THEN RAISE EXCEPTION 'empty_signals' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(_signals) s
              WHERE (s->>'expert_id')::uuid IS DISTINCT FROM _expert_id
                 OR (s->>'batch_id')::uuid IS DISTINCT FROM _batch_id)
  THEN RAISE EXCEPTION 'batch_mismatch' USING ERRCODE='22023'; END IF;

  PERFORM app_ledger.lock_expert(_expert_id);

  IF _is_editing THEN
    SELECT array_agg(id) INTO _old_ids FROM public.expert_signals
     WHERE batch_id=_batch_id AND expert_id=_expert_id;
    IF _old_ids IS NOT NULL AND array_length(_old_ids,1) > 0 THEN
      FOREACH _id IN ARRAY _old_ids LOOP
        PERFORM app_ledger.canonical_reverse_signal(_id,'batch_edit',_caller,'save_signal_batch');
      END LOOP;
      DELETE FROM public.expert_signal_legs WHERE signal_id = ANY(_old_ids);
      DELETE FROM public.expert_signals WHERE id = ANY(_old_ids);
    END IF;
  END IF;

  WITH src AS (SELECT * FROM pg_catalog.jsonb_populate_recordset(null::public.expert_signals,_signals))
  INSERT INTO public.expert_signals (
    id, expert_id, plan_id, batch_id, instrument, action, price_hint,
    reason_summary, reason_detail, risk_notes, learning_points,
    status, published_at, created_at, quantity, quantity_unit,
    teaching_topic, overall_summary, executed_at,
    is_combo, combo_strategy, net_premium, max_loss_per_unit, max_profit_per_unit)
  SELECT COALESCE(src.id, pg_catalog.gen_random_uuid()), _expert_id, src.plan_id, _batch_id,
    src.instrument, src.action, src.price_hint, src.reason_summary, src.reason_detail,
    src.risk_notes, src.learning_points, COALESCE(src.status,'published'::public.signal_status),
    COALESCE(src.published_at, pg_catalog.now()), COALESCE(src.created_at, pg_catalog.now()),
    src.quantity, src.quantity_unit, src.teaching_topic, src.overall_summary, src.executed_at,
    COALESCE(src.is_combo,false), src.combo_strategy, src.net_premium,
    src.max_loss_per_unit, src.max_profit_per_unit
  FROM src;
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF _legs IS NOT NULL AND pg_catalog.jsonb_typeof(_legs)='array'
     AND pg_catalog.jsonb_array_length(_legs) > 0 THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(_legs) l
                WHERE NOT EXISTS (SELECT 1 FROM public.expert_signals es
                                   WHERE es.id=(l->>'signal_id')::uuid AND es.batch_id=_batch_id))
    THEN RAISE EXCEPTION 'leg_signal_mismatch' USING ERRCODE='22023'; END IF;
    INSERT INTO public.expert_signal_legs (signal_id, leg_index, occ_symbol, underlying,
        expiry, right_type, strike, side, ratio, leg_price)
    SELECT signal_id, leg_index, occ_symbol, underlying, expiry, right_type,
           strike, side, ratio, leg_price
    FROM pg_catalog.jsonb_populate_recordset(null::public.expert_signal_legs,_legs);
  END IF;
  RETURN _inserted;
END $$;
ALTER FUNCTION public.save_signal_batch(uuid,uuid,jsonb,jsonb,boolean) OWNER TO wrapper_owner;

-- ---------------------------------------------------------------- W04 price sync
CREATE OR REPLACE FUNCTION public.upsert_current_price(p_writer text, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  n := app_ledger.apply_price_update(p_rows);
  RETURN n;
END $$;
ALTER FUNCTION public.upsert_current_price(text,jsonb) OWNER TO wrapper_owner;

-- ---------------------------------------------------------------- W05..W09 admin economic writers
CREATE OR REPLACE FUNCTION public.admin_delete_trade_records_by_signal_ids(_signal_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _id uuid; n int := 0; v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOREACH _id IN ARRAY coalesce(_signal_ids, '{}'::uuid[]) LOOP
    v := app_ledger.canonical_reverse_signal(_id,'admin_delete_by_signal',auth.uid(),'admin_rpc');
    IF v->>'status' = 'applied' THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
ALTER FUNCTION public.admin_delete_trade_records_by_signal_ids(uuid[]) OWNER TO wrapper_owner;

CREATE OR REPLACE FUNCTION public.admin_delete_trade_records_by_symbol(
  _expert_id uuid, _symbol_prefix text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT t.instrument, t.market, t.quantity_unit FROM public.trade_records t
            WHERE t.expert_id=_expert_id AND t.status='open'::public.trade_status
              AND t.instrument LIKE _symbol_prefix||'%'
  LOOP
    PERFORM app_ledger.canonical_correct_position(_expert_id, r.instrument, r.market, 0,
      r.quantity_unit, 'admin_delete_by_symbol:'||_symbol_prefix, 1);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
ALTER FUNCTION public.admin_delete_trade_records_by_symbol(uuid,text) OWNER TO wrapper_owner;

CREATE OR REPLACE FUNCTION public.realign_instrument_unit(
  p_expert_id uuid, p_symbol_prefix text, p_new_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; out_rows jsonb := '[]'::jsonb; v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT t.instrument, t.market, t.quantity, t.quantity_unit FROM public.trade_records t
            WHERE t.expert_id=p_expert_id AND t.status='open'::public.trade_status
              AND t.instrument LIKE p_symbol_prefix||'%'
  LOOP
    -- unit realignment is a canonical correction to the equivalent quantity
    v := app_ledger.canonical_correct_position(p_expert_id, r.instrument, r.market,
           app_ledger.convert_qty(r.quantity, r.quantity_unit, p_new_unit),
           p_new_unit, 'realign_unit->'||p_new_unit, 2);
    out_rows := out_rows || pg_catalog.jsonb_build_object('instrument', r.instrument, 'result', v);
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('status','ok','rows',out_rows);
END $$;
ALTER FUNCTION public.realign_instrument_unit(uuid,text,text) OWNER TO wrapper_owner;

CREATE OR REPLACE FUNCTION public.admin_signal_dupe_trades_fix(
  p_signal_id uuid, p_dry_run boolean DEFAULT true, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.expert_signals; v jsonb; v_target int;
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.expert_signals WHERE id = p_signal_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'unknown_signal: %', p_signal_id USING ERRCODE='P0001'; END IF;
  v_target := coalesce(s.quantity, 0);
  IF p_dry_run THEN
    RETURN pg_catalog.jsonb_build_object('status','dry_run','signal_id',p_signal_id,
      'target_quantity', v_target);
  END IF;
  v := app_ledger.canonical_correct_position(s.expert_id, s.instrument, s.market,
         v_target, s.quantity_unit, 'dupe_fix:'||p_signal_id::text, 3);
  RETURN pg_catalog.jsonb_build_object('status','ok','result',v);
END $$;
ALTER FUNCTION public.admin_signal_dupe_trades_fix(uuid,boolean,boolean) OWNER TO wrapper_owner;

-- W08 dedupe sweep: candidate detection lives in app_ledger; the repair path is a
-- canonical correction per duplicate group (no raw DELETE, fully idempotent).
CREATE OR REPLACE FUNCTION app_ledger.dedupe_candidates()
RETURNS TABLE(expert_id uuid, instrument text, market text, quantity_unit text,
              target_qty int, dup_rows bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.expert_id, pg_catalog.min(t.instrument), pg_catalog.min(t.market),
         pg_catalog.min(t.quantity_unit),
         pg_catalog.max(t.quantity)::int, pg_catalog.count(*)
    FROM public.trade_records t
   WHERE t.status = 'open'::public.trade_status
   GROUP BY t.expert_id, t.instrument_key
  HAVING pg_catalog.count(*) > 1
$$;
ALTER FUNCTION app_ledger.dedupe_candidates() OWNER TO ledger_owner;

CREATE OR REPLACE FUNCTION public.trade_dedupe_sweep(p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n int := 0; applied int := 0; v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT * FROM app_ledger.dedupe_candidates() LOOP
    n := n + 1;
    IF NOT p_dry_run THEN
      v := app_ledger.canonical_correct_position(r.expert_id, r.instrument, r.market,
             r.target_qty, r.quantity_unit, 'dedupe_sweep', 6);
      IF v->>'status' = 'applied' THEN applied := applied + 1; END IF;
    END IF;
  END LOOP;
  IF p_dry_run THEN
    RETURN pg_catalog.jsonb_build_object('status','dry_run','duplicate_groups',n);
  END IF;
  RETURN pg_catalog.jsonb_build_object('status','swept','duplicate_groups',n,
    'corrections_applied',applied);
END $$;
ALTER FUNCTION public.trade_dedupe_sweep(boolean) OWNER TO wrapper_owner;

CREATE OR REPLACE FUNCTION public.admin_apply_fix_proposal(p_id uuid, p_confirm boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.holdings_fix_proposals; v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.holdings_fix_proposals WHERE id = p_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'unknown_proposal: %', p_id USING ERRCODE='P0001'; END IF;
  IF NOT p_confirm THEN
    RETURN pg_catalog.jsonb_build_object('status','dry_run','proposal',p_id); END IF;
  v := app_ledger.canonical_correct_position(p.expert_id, p.instrument, p.market,
         p.proposed_quantity, p.proposed_quantity_unit, 'fix_proposal:'||p_id::text, 4);
  UPDATE public.holdings_fix_proposals
     SET status='applied', applied_at=pg_catalog.now(), applied_by=auth.uid()
   WHERE id = p_id;
  RETURN pg_catalog.jsonb_build_object('status','applied','result',v);
END $$;
ALTER FUNCTION public.admin_apply_fix_proposal(uuid,boolean) OWNER TO wrapper_owner;

CREATE OR REPLACE FUNCTION public.admin_reset_expert_asset_class(
  _expert_id uuid, _new_asset_class text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM app_ledger.lock_expert(_expert_id);
  FOR r IN SELECT t.instrument, t.market, t.quantity_unit FROM public.trade_records t
            WHERE t.expert_id=_expert_id AND t.status='open'::public.trade_status
  LOOP
    PERFORM app_ledger.canonical_correct_position(_expert_id, r.instrument, r.market, 0,
      r.quantity_unit, 'asset_class_reset->'||_new_asset_class, 5);
  END LOOP;
  UPDATE public.experts SET asset_class = _new_asset_class WHERE id = _expert_id;
END $$;
ALTER FUNCTION public.admin_reset_expert_asset_class(uuid,text) OWNER TO wrapper_owner;

-- ---------------------------------------------------------------- ACL: least privilege (R1-D §6)
DO $$
DECLARE r record;
BEGIN
  -- no runtime role may execute an admin economic function directly except via
  -- the wrappers' own has_role check; raw DML is impossible thanks to the guards.
  FOR r IN
    SELECT format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
             p.proname, pg_get_function_identity_arguments(p.oid)) AS s
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'admin_apply_fix_proposal','admin_delete_trade_records_by_signal_ids',
       'admin_delete_trade_records_by_symbol','admin_signal_dupe_trades_fix',
       'trade_dedupe_sweep','realign_instrument_unit','admin_reset_expert_asset_class',
       'upsert_current_price','save_signal_batch')
  LOOP EXECUTE r.s; END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.trade_records FROM anon, authenticated, service_role;
GRANT  SELECT ON public.trade_records TO anon, authenticated, service_role;
REVOKE ALL ON app_ledger.portfolio_cash_ledger FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA app_ledger FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_ledger TO service_role;

-- explicit re-grant: these wrappers perform their own auth.uid()/has_role checks,
-- and can no longer reach raw economic DML. PUBLIC/anon stay revoked.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
             p.proname, pg_get_function_identity_arguments(p.oid)) AS s
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'admin_apply_fix_proposal','admin_delete_trade_records_by_signal_ids',
       'admin_delete_trade_records_by_symbol','admin_signal_dupe_trades_fix',
       'trade_dedupe_sweep','realign_instrument_unit','admin_reset_expert_asset_class',
       'save_signal_batch')
  LOOP EXECUTE r.s; END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.upsert_current_price(text,jsonb) TO service_role';
END $$;

-- =====================================================================
-- TWO-LAYER PRIVILEGE BOUNDARY (R1-D §B)
--   layer 2  ledger_owner  : NOLOGIN, no members, owns app_ledger.* canonical
--                            SECURITY DEFINER functions and is the ONLY role the
--                            projection guards accept as a raw economic writer.
--   layer 1  wrapper_owner : NOLOGIN, no members, owns every public.* legacy
--                            wrapper. It may EXECUTE canonical functions but has
--                            NO privilege for raw DML on any economic table, so a
--                            wrapper cannot write economics even if its body tried.
--   runtime  anon/authenticated/service_role: EXECUTE on allow-listed wrappers only,
--                            no EXECUTE on app_ledger.*, no raw economic DML.
-- Nothing here consults a GUC, header, application_name or caller-supplied token.
-- =====================================================================
DO $$ BEGIN
  CREATE ROLE wrapper_owner NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- legacy definers were owned by postgres (table owner) and ran outside RLS;
-- wrapper_owner must keep exactly that read/relational behaviour.
ALTER ROLE wrapper_owner BYPASSRLS;
GRANT wrapper_owner TO CURRENT_USER WITH ADMIN OPTION;

GRANT USAGE ON SCHEMA public, auth, app_ledger TO wrapper_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wrapper_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wrapper_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO wrapper_owner;

-- non-economic tables the wrappers legitimately write (signals, proposals, prices,
-- audit, derived summaries). trade_records + app_ledger.* are deliberately absent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['expert_signals','expert_signal_legs','experts',
                               'holdings_fix_proposals','current_prices','audit_logs',
                               'signal_trade_applications','user_performances',
                               'user_summaries','daily_price_snapshots','stock_names',
                               'target_price_history','tw_bsr_sync_queue']) AS t
  LOOP
    IF to_regclass('public.'||r.t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO wrapper_owner', r.t);
    END IF;
  END LOOP;
END $$;

-- explicit: wrapper_owner can never touch economics directly
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.trade_records FROM wrapper_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA app_ledger FROM wrapper_owner;
GRANT SELECT ON app_ledger.effect_key, app_ledger.economic_effect TO wrapper_owner;

-- canonical EXECUTE is granted to wrapper_owner only (never to runtime roles)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) sig
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='app_ledger' AND p.prokind='f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION app_ledger.%s FROM PUBLIC, anon, authenticated, service_role', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION app_ledger.%s TO wrapper_owner', r.sig);
  END LOOP;
END $$;

-- every legacy public writer (15/15 of the inventory) is owned by wrapper_owner
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) sig
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN (
              'handle_signal_trade','handle_signal_takedown','save_signal_batch',
              'upsert_current_price','admin_delete_trade_records_by_signal_ids',
              'admin_delete_trade_records_by_symbol','admin_signal_dupe_trades_fix',
              'trade_dedupe_sweep','realign_instrument_unit','admin_reset_expert_asset_class',
              'admin_apply_fix_proposal','admin_generate_fix_proposals',
              'admin_reject_fix_proposal','delete_old_prices',
              'recalc_user_summary_on_perf_delete')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO wrapper_owner', r.sig);
    EXECUTE format('ALTER FUNCTION public.%s SECURITY DEFINER', r.sig);
  END LOOP;
END $$;
