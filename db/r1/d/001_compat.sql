-- =====================================================================
-- R1-D 001 COMPAT — privilege boundary + canonical signal writer
-- Runs as: postgres (owner of public.*, ADMIN of ledger_owner)
-- Idempotent. DDL + function bodies only; writes no economic row.
--
-- Boundary model (R1-D §2):
--   * app_ledger.* is owned by ledger_owner (NOLOGIN, no members).
--   * The only way current_user can become ledger_owner is by entering a
--     SECURITY DEFINER function owned by ledger_owner. No runtime role can
--     SET ROLE ledger_owner (no membership), so the identity is unforgeable.
--   * The projection guards run SECURITY INVOKER and therefore observe the
--     REAL writer identity. They demand current_user = ledger_owner *and* a
--     matching unconsumed mutation token. No GUC / header / application_name
--     is consulted anywhere.
-- =====================================================================
SET lock_timeout = '3s';
SET statement_timeout = '300s';

-- ---------------------------------------------------------------- 1. ownership
DO $$
DECLARE r record;
BEGIN
  EXECUTE 'ALTER SCHEMA app_ledger OWNER TO ledger_owner';
  FOR r IN
    SELECT format('ALTER %s app_ledger.%I OWNER TO ledger_owner',
             CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'TABLE'
                            WHEN 'v' THEN 'VIEW'  WHEN 'm' THEN 'MATERIALIZED VIEW'
                            WHEN 'S' THEN 'SEQUENCE' END, c.relname) AS s
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app_ledger' AND c.relkind IN ('r','p','v','m','S')
  LOOP EXECUTE r.s; END LOOP;

  FOR r IN
    SELECT format('ALTER FUNCTION app_ledger.%I(%s) OWNER TO ledger_owner',
                  p.proname, pg_get_function_identity_arguments(p.oid)) AS s
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_ledger'
  LOOP EXECUTE r.s; END LOOP;
END $$;

-- Legacy definers were owned by postgres (the table owner) and therefore ran
-- outside RLS. ledger_owner must keep that exact behaviour, otherwise the
-- compat wrappers change semantics. BYPASSRLS is safe here: ledger_owner is
-- NOLOGIN and has no members, so no runtime role can assume it.
ALTER ROLE ledger_owner BYPASSRLS;

-- ledger_owner is the ONLY role allowed to perform raw economic DML.
GRANT USAGE ON SCHEMA public TO ledger_owner;
-- Keep the canonical owner narrowly scoped. It needs broad reads to derive and
-- verify effects, but raw public-table DML is restricted to the projection table.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ledger_owner;
GRANT INSERT, UPDATE, DELETE ON public.trade_records TO ledger_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_owner;
GRANT USAGE ON SCHEMA auth TO ledger_owner;

-- ---------------------------------------------------------------- 2. guards -> SECURITY INVOKER
-- (R0/R1 failure ledger F-R1-01: as SECURITY DEFINER the guard could not see the
--  real writer, so any postgres-owned legacy definer function looked identical to
--  the canonical writer.)
CREATE OR REPLACE FUNCTION app_ledger.assert_canonical_writer(p_what text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user <> 'ledger_owner' THEN
    RAISE EXCEPTION 'unauthorized_%_mutation: writer=% (only ledger_owner may write economics)',
      p_what, current_user USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_ledger.trade_records_economic_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_o jsonb; v_n jsonb; v_before text; v_after text; tok record; v_rowid uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_o := pg_catalog.to_jsonb(OLD) - 'current_price' - 'price_updated_at';
    v_n := pg_catalog.to_jsonb(NEW) - 'current_price' - 'price_updated_at';
    IF v_o = v_n THEN RETURN NEW; END IF;     -- price-only whitelist fast path (R1-D §6)
    v_before := app_ledger.tr_econ_hash(OLD);
    v_rowid  := OLD.id;
  ELSIF TG_OP = 'INSERT' THEN
    v_before := NULL; v_rowid := NEW.id;
  ELSE
    v_before := app_ledger.tr_econ_hash(OLD); v_rowid := OLD.id;
  END IF;

  PERFORM app_ledger.assert_canonical_writer('trade_records');

  IF TG_OP <> 'DELETE' THEN
    IF NEW.market IS NULL OR pg_catalog.btrim(NEW.market) = ''
       OR NEW.currency IS NULL OR pg_catalog.btrim(NEW.currency) = ''
       OR NEW.quantity_unit IS NULL THEN
      RAISE EXCEPTION 'null_economic_context: market/currency/quantity_unit required'
        USING ERRCODE='P0001';
    END IF;
    NEW.last_event_id := NULL; NEW.last_projection_mutation_id := NULL;
    v_after := app_ledger.tr_econ_hash(NEW);
  END IF;

  SELECT * INTO tok FROM app_ledger.effect_projection_mutation m
   WHERE m.consumed = false
     AND m.target_table = 'trade_records'
     AND m.op = pg_catalog.lower(TG_OP)
     AND m.target_row_id = v_rowid
     AND m.before_hash IS NOT DISTINCT FROM v_before
     AND m.after_hash  IS NOT DISTINCT FROM v_after
   ORDER BY m.mutation_seq FOR UPDATE LIMIT 1;

  IF tok IS NULL THEN
    RAISE EXCEPTION 'unauthorized_trade_records_mutation: op=% row=%', TG_OP, v_rowid
      USING ERRCODE='P0001';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.id IS DISTINCT FROM tok.target_row_id THEN
    RAISE EXCEPTION 'insert_token_row_mismatch' USING ERRCODE='P0001';
  END IF;

  UPDATE app_ledger.effect_projection_mutation SET consumed = true
   WHERE mutation_id = tok.mutation_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.last_event_id := tok.event_id;
  NEW.last_projection_mutation_id := tok.mutation_id;
  RETURN NEW;
END $$;
ALTER FUNCTION app_ledger.trade_records_economic_guard() OWNER TO ledger_owner;
GRANT EXECUTE ON FUNCTION app_ledger.assert_canonical_writer(text) TO postgres;

CREATE OR REPLACE FUNCTION app_ledger.cash_ledger_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_after text; tok record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cash_ledger_append_only' USING ERRCODE='P0001';
  END IF;
  PERFORM app_ledger.assert_canonical_writer('cash_ledger');
  v_after := app_ledger.cash_econ_hash(NEW);
  SELECT * INTO tok FROM app_ledger.effect_projection_mutation m
   WHERE m.consumed = false AND m.target_table='portfolio_cash_ledger'
     AND m.op='insert' AND m.target_row_id = NEW.cash_entry_id
     AND m.after_hash IS NOT DISTINCT FROM v_after
   FOR UPDATE LIMIT 1;
  IF tok IS NULL THEN
    RAISE EXCEPTION 'unauthorized_cash_ledger_mutation' USING ERRCODE='P0001';
  END IF;
  UPDATE app_ledger.effect_projection_mutation SET consumed=true WHERE mutation_id=tok.mutation_id;
  RETURN NEW;
END $$;
ALTER FUNCTION app_ledger.cash_ledger_guard() OWNER TO ledger_owner;

-- ---------------------------------------------------------------- 3. idempotency keys (R1-D §3)
CREATE TABLE IF NOT EXISTS app_ledger.effect_key (
  logical_effect_id uuid PRIMARY KEY,
  origin_signal_id  uuid NOT NULL,
  effect_kind       text NOT NULL CHECK (effect_kind IN ('signal_execution','signal_reversal','correction')),
  correction_no     int  NOT NULL DEFAULT 0 CHECK (correction_no >= 0),
  expert_id         uuid NOT NULL,
  event_id          uuid NULL REFERENCES app_ledger.economic_effect(event_id),
  effect_logical_id uuid NULL,
  state             text NOT NULL DEFAULT 'reserved'
                    CHECK (state IN ('reserved','applied','no_effect','manual_review','reversed')),
  detail            text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT effect_key_unique UNIQUE (origin_signal_id, effect_kind, correction_no)
);
ALTER TABLE app_ledger.effect_key OWNER TO ledger_owner;

-- Deterministic, DB-derived. The caller cannot supply or influence this value
-- beyond naming the signal it is acting on.
CREATE OR REPLACE FUNCTION app_ledger.derive_logical_effect_id(
  p_signal uuid, p_kind text, p_no int DEFAULT 0)
RETURNS uuid LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT pg_catalog.md5('legendflow.effect:v1:'||p_signal::text||':'||p_kind||':'||p_no::text)::uuid
$$;
ALTER FUNCTION app_ledger.derive_logical_effect_id(uuid,text,int) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- 4. same-expert serialization
CREATE OR REPLACE FUNCTION app_ledger.lock_expert(p_expert uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_expert IS NULL THEN
    RAISE EXCEPTION 'lock_expert_requires_expert' USING ERRCODE='P0001'; END IF;
  -- transaction-scoped, cannot be released or faked by the caller
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app_ledger.expert:'||p_expert::text, 0));
END $$;
ALTER FUNCTION app_ledger.lock_expert(uuid) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- 5. canonical signal writer
-- Single economic entry point for every signal-driven writer (W01/W02/W03/E07/E08).
-- Returns jsonb: {status, logical_effect_id, event_id, detail}
--   status: applied | noop_idempotent | no_effect | manual_review
CREATE OR REPLACE FUNCTION app_ledger.canonical_apply_signal(
  p_signal_id uuid, p_actor uuid DEFAULT NULL, p_via text DEFAULT 'compat_wrapper')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.expert_signals;
  e public.experts;
  v_key uuid;
  v_row app_ledger.effect_key;
  v_action text;
  v_event uuid;
  v_qty int;
  v_open public.trade_records;
  v_ikey text;
  v_reason text;
BEGIN
  SELECT * INTO s FROM public.expert_signals WHERE id = p_signal_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'unknown_signal: %', p_signal_id USING ERRCODE='P0001';
  END IF;
  PERFORM app_ledger.lock_expert(s.expert_id);
  SELECT * INTO e FROM public.experts WHERE id = s.expert_id;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'unknown_expert: %', s.expert_id USING ERRCODE='P0001';
  END IF;

  v_key := app_ledger.derive_logical_effect_id(p_signal_id, 'signal_execution', 0);

  -- (a) idempotency gate — exact retry, batch retry, Edge timeout retry, concurrent
  --     insert/update all converge here because of the expert lock above.
  SELECT * INTO v_row FROM app_ledger.effect_key WHERE logical_effect_id = v_key;
  IF v_row.logical_effect_id IS NOT NULL AND v_row.state IN ('applied','no_effect') THEN
    RETURN pg_catalog.jsonb_build_object('status','noop_idempotent',
      'logical_effect_id', v_key, 'event_id', v_row.event_id, 'detail', v_row.state);
  END IF;

  -- (b) non-economic signal kinds
  v_action := s.action::text;
  IF v_action IN ('hold','teaching') THEN
    INSERT INTO app_ledger.effect_key(logical_effect_id, origin_signal_id, effect_kind,
        expert_id, state, detail)
      VALUES (v_key, p_signal_id, 'signal_execution', s.expert_id, 'no_effect', 'non_economic_action')
      ON CONFLICT (logical_effect_id) DO UPDATE SET state='no_effect', updated_at=now();
    RETURN pg_catalog.jsonb_build_object('status','no_effect','logical_effect_id',v_key,
      'detail','non_economic_action');
  END IF;

  -- (c) embargo semantics (R1-D §3): executed_at decides whether the economics
  --     already happened. status only decides visibility.
  IF s.executed_at IS NULL THEN
    v_reason := 'missing_executed_at';
  ELSIF s.quantity IS NULL OR s.quantity <= 0 THEN
    v_reason := 'missing_quantity';
  ELSIF s.price_hint IS NULL THEN
    v_reason := 'missing_price';
  ELSIF s.market IS NULL OR pg_catalog.btrim(s.market) = '' THEN
    v_reason := 'missing_market';
  ELSIF coalesce(e.base_currency, e.currency, '') NOT IN ('TWD','USD') THEN
    v_reason := 'missing_currency';
  ELSE
    v_reason := NULL;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO app_ledger.effect_key(logical_effect_id, origin_signal_id, effect_kind,
        expert_id, state, detail)
      VALUES (v_key, p_signal_id, 'signal_execution', s.expert_id, 'manual_review', v_reason)
      ON CONFLICT (logical_effect_id) DO UPDATE SET state='manual_review', detail=EXCLUDED.detail,
        updated_at=now();
    PERFORM app_ledger.canonical_review(v_key, 'manual_review', v_reason, p_actor, p_via);
    RETURN pg_catalog.jsonb_build_object('status','manual_review','logical_effect_id',v_key,
      'detail', v_reason);
  END IF;

  -- (d) reserve the key BEFORE writing economics; a concurrent duplicate blocks on
  --     the expert lock and then sees state='applied'.
  INSERT INTO app_ledger.effect_key(logical_effect_id, origin_signal_id, effect_kind,
      expert_id, state, detail)
    VALUES (v_key, p_signal_id, 'signal_execution', s.expert_id, 'reserved', 'reserved')
    ON CONFLICT (logical_effect_id) DO UPDATE SET state='reserved', updated_at=now();

  v_qty := s.quantity;
  IF v_action = 'sell' THEN v_action := 'exit'; END IF;
  IF v_action = 'exit' THEN
    v_ikey := public.economic_instrument_key(s.market, s.instrument);
    SELECT * INTO v_open FROM public.trade_records t
     WHERE t.expert_id = s.expert_id AND t.instrument_key = v_ikey
       AND t.status = 'open'::public.trade_status AND t.quantity > 0
     FOR UPDATE;
    IF v_open.id IS NULL THEN
      UPDATE app_ledger.effect_key SET state='manual_review', detail='exit_without_open_position',
             updated_at=now() WHERE logical_effect_id = v_key;
      PERFORM app_ledger.canonical_review(v_key,'manual_review','exit_without_open_position',p_actor,p_via);
      RETURN pg_catalog.jsonb_build_object('status','manual_review','logical_effect_id',v_key,
        'detail','exit_without_open_position');
    END IF;
    v_qty := v_open.quantity;    -- full exit is authoritative from the projection
  END IF;

  v_event := app_ledger.canonical_apply_effect(pg_catalog.jsonb_build_object(
    'action', v_action,
    'expert_id', s.expert_id,
    'instrument', s.instrument,
    'market', s.market,
    'currency', coalesce(e.base_currency, e.currency),
    'qty', v_qty,
    'qty_unit', s.quantity_unit,
    'price', s.price_hint,
    'effective_at', s.executed_at,
    'signal_id', s.id,
    'provenance', 'signal_execution',
    'actor_via', p_via,
    'reason', 'signal:'||s.id::text));

  -- canonical_apply_effect owns the atomic effect -> token -> projection ->
  -- verify -> applied transaction. Bind its DB-created logical chain to the
  -- deterministic signal key only after that transaction has succeeded.
  IF NOT EXISTS (
    SELECT 1 FROM app_ledger.economic_effect ee
     WHERE ee.event_id=v_event AND ee.origin_signal_id=s.id AND ee.state='applied'
       AND (SELECT count(*) FROM app_ledger.effect_projection_mutation m
             WHERE m.event_id=ee.event_id AND m.consumed)
           = ee.expected_mutation_count
  ) THEN
    RAISE EXCEPTION 'canonical_signal_effect_not_fully_applied: %', v_event
      USING ERRCODE='P0001';
  END IF;

  UPDATE app_ledger.effect_key
     SET state='applied', event_id=v_event, updated_at=now(), detail='applied',
         effect_logical_id = (SELECT logical_effect_id FROM app_ledger.economic_effect
                               WHERE event_id = v_event)
   WHERE logical_effect_id = v_key;

  -- visibility follows status, and never re-applies economics
  IF s.status::text = 'published' THEN
    PERFORM app_ledger.publish_signal_effect(p_signal_id);
  END IF;

  RETURN pg_catalog.jsonb_build_object('status','applied','logical_effect_id',v_key,
    'event_id', v_event, 'detail','applied');
END $$;
ALTER FUNCTION app_ledger.canonical_apply_signal(uuid,uuid,text) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- 6. publish = visibility only
CREATE OR REPLACE FUNCTION app_ledger.publish_signal_effect(p_signal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key uuid; v_row app_ledger.effect_key; n int := 0;
BEGIN
  v_key := app_ledger.derive_logical_effect_id(p_signal_id, 'signal_execution', 0);
  SELECT * INTO v_row FROM app_ledger.effect_key WHERE logical_effect_id = v_key;
  IF v_row.logical_effect_id IS NULL OR v_row.event_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status','no_effect_to_publish','logical_effect_id',v_key);
  END IF;
  UPDATE app_ledger.economic_effect
     SET visible_at = pg_catalog.now(), state_changed_at = pg_catalog.now()
   WHERE event_id = v_row.event_id AND visible_at IS NULL AND state = 'applied';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object('status', CASE WHEN n>0 THEN 'published' ELSE 'already_visible' END,
    'logical_effect_id', v_key, 'event_id', v_row.event_id);
END $$;
ALTER FUNCTION app_ledger.publish_signal_effect(uuid) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- 7. reversal (takedown / admin delete)
CREATE OR REPLACE FUNCTION app_ledger.canonical_reverse_signal(
  p_signal_id uuid, p_reason text, p_actor uuid DEFAULT NULL, p_via text DEFAULT 'compat_wrapper')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_src app_ledger.effect_key; v_key uuid; v_row app_ledger.effect_key;
        e record; v_event uuid; v_action text;
BEGIN
  v_src := NULL;
  SELECT * INTO v_src FROM app_ledger.effect_key
   WHERE logical_effect_id = app_ledger.derive_logical_effect_id(p_signal_id,'signal_execution',0);
  IF v_src.logical_effect_id IS NULL OR v_src.state <> 'applied' THEN
    RETURN pg_catalog.jsonb_build_object('status','nothing_to_reverse','signal_id',p_signal_id);
  END IF;
  PERFORM app_ledger.lock_expert(v_src.expert_id);

  v_key := app_ledger.derive_logical_effect_id(p_signal_id, 'signal_reversal', 0);
  SELECT * INTO v_row FROM app_ledger.effect_key WHERE logical_effect_id = v_key;
  IF v_row.logical_effect_id IS NOT NULL AND v_row.state = 'applied' THEN
    RETURN pg_catalog.jsonb_build_object('status','noop_idempotent','logical_effect_id',v_key,
      'event_id', v_row.event_id);
  END IF;

  SELECT * INTO e FROM app_ledger.economic_effect WHERE event_id = v_src.event_id;
  IF e.qty_delta = 0 THEN
    RETURN pg_catalog.jsonb_build_object('status','no_effect','logical_effect_id',v_key);
  END IF;

  INSERT INTO app_ledger.effect_key(logical_effect_id, origin_signal_id, effect_kind,
      expert_id, state, detail)
    VALUES (v_key, p_signal_id, 'signal_reversal', v_src.expert_id, 'reserved', p_reason)
    ON CONFLICT (logical_effect_id) DO UPDATE SET state='reserved', updated_at=now();

  -- cash- and P&L-neutral quantity correction (F2 semantics)
  v_event := app_ledger.canonical_apply_effect(pg_catalog.jsonb_build_object(
    'action','quantity_adjustment', 'expert_id', e.expert_id, 'instrument', e.instrument,
    'market', e.market, 'currency', e.currency, 'qty', -e.qty_delta,
    'qty_unit', e.qty_unit, 'cost_delta', 0,
    'effective_at', pg_catalog.now(), 'signal_id', p_signal_id,
    'provenance','quantity_adjustment','actor_via',p_via,
    'reason','reversal:'||p_reason));

  UPDATE app_ledger.effect_key SET state='applied', event_id=v_event, updated_at=now()
   WHERE logical_effect_id = v_key;
  UPDATE app_ledger.effect_key SET state='reversed', updated_at=now()
   WHERE logical_effect_id = v_src.logical_effect_id;
  RETURN pg_catalog.jsonb_build_object('status','applied','logical_effect_id',v_key,'event_id',v_event);
END $$;
ALTER FUNCTION app_ledger.canonical_reverse_signal(uuid,text,uuid,text) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- 8. price whitelist (R1-D §6)
-- The ONLY path a price syncer may use. Anything but current_price /
-- price_updated_at is rejected before a single row is touched.
CREATE OR REPLACE FUNCTION app_ledger.apply_price_update(p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; k text; n int := 0; m int; old_row public.trade_records;
        new_row public.trade_records; forbidden jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'price_payload_must_be_array' USING ERRCODE='P0001'; END IF;
  FOR r IN SELECT * FROM pg_catalog.jsonb_array_elements(p_rows) LOOP
    FOR k IN SELECT pg_catalog.jsonb_object_keys(r) LOOP
      IF k NOT IN ('trade_record_id','current_price','price_updated_at') THEN
        RAISE EXCEPTION 'price_field_not_whitelisted: %', k USING ERRCODE='P0001';
      END IF;
    END LOOP;
    IF NOT (r ? 'trade_record_id') OR NOT (r ? 'current_price') THEN
      RAISE EXCEPTION 'price_payload_incomplete' USING ERRCODE='P0001'; END IF;
    SELECT * INTO old_row FROM public.trade_records
     WHERE id=(r->>'trade_record_id')::uuid FOR UPDATE;
    IF old_row.id IS NULL THEN CONTINUE; END IF;
    new_row := old_row;
    new_row.current_price := (r->>'current_price')::numeric;
    new_row.price_updated_at := coalesce((r->>'price_updated_at')::timestamptz, pg_catalog.now());
    forbidden := (pg_catalog.to_jsonb(new_row) - 'current_price' - 'price_updated_at')
                 - (pg_catalog.to_jsonb(old_row) - 'current_price' - 'price_updated_at');
    IF forbidden <> '{}'::jsonb THEN
      RAISE EXCEPTION 'price_update_changed_non_whitelisted_columns: %', forbidden
        USING ERRCODE='P0001';
    END IF;
    UPDATE public.trade_records SET current_price=new_row.current_price,
      price_updated_at=new_row.price_updated_at WHERE id=old_row.id;
    GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  END LOOP;
  RETURN n;
END $$;
ALTER FUNCTION app_ledger.apply_price_update(jsonb) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- 9. EXECUTE ACL (least privilege)
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION app_ledger.apply_price_update(jsonb) TO service_role;
GRANT  EXECUTE ON FUNCTION app_ledger.publish_signal_effect(uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION app_ledger.canonical_apply_signal(uuid,uuid,text) TO service_role;

-- ---------------------------------------------------------------- 10. unit conversion helper
CREATE OR REPLACE FUNCTION app_ledger.convert_qty(p_qty int, p_from text, p_to text)
RETURNS int LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_qty IS NULL THEN RETURN NULL; END IF;
  IF p_from IS NOT DISTINCT FROM p_to THEN RETURN p_qty; END IF;
  IF p_from = '張' AND p_to = '股' THEN RETURN p_qty * 1000; END IF;
  IF p_from = '股' AND p_to = '張' THEN
    IF p_qty % 1000 <> 0 THEN
      RAISE EXCEPTION 'unit_conversion_lossy: % 股 -> 張', p_qty USING ERRCODE='P0001'; END IF;
    RETURN p_qty / 1000;
  END IF;
  RAISE EXCEPTION 'unit_conversion_unsupported: % -> %', p_from, p_to USING ERRCODE='P0001';
END $$;
ALTER FUNCTION app_ledger.convert_qty(int,text,text) OWNER TO ledger_owner;
