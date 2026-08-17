-- R1-002 LEDGER CORE (production-adapted from db/e0/01_ledger.sql)
-- Runs as: ledger_owner for app_ledger objects; postgres for public.* triggers/grants.
-- E0 origin: (economic_effect, mutation tokens, guards, invariants)

DROP TYPE IF EXISTS public.effect_provenance CASCADE;
CREATE TYPE public.effect_provenance AS ENUM (
  'signal_execution','external_capital_flow','historical_fill',
  'equity_bridge','quantity_adjustment','break_glass');

CREATE SEQUENCE app_ledger.projection_version_seq;
CREATE SEQUENCE app_ledger.effect_no_seq;

-- ---------------------------------------------------------------- economic_effect
CREATE TABLE app_ledger.economic_effect (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_effect_id uuid NOT NULL,
  event_version int NOT NULL DEFAULT 1,
  supersedes_event_id uuid NULL REFERENCES app_ledger.economic_effect(event_id),
  expert_id uuid NOT NULL,
  origin_signal_id uuid NULL,
  market text NULL,
  instrument text NULL,
  instrument_key text NULL,
  action text NOT NULL,
  qty_delta integer NOT NULL,
  qty_unit text NOT NULL DEFAULT 'share',
  currency text NOT NULL CHECK (currency IN ('TWD','USD')),
  cash_delta numeric NULL,
  price numeric NULL,
  fees numeric NOT NULL DEFAULT 0,
  fee_model text NOT NULL DEFAULT 'none',
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  provenance public.effect_provenance NOT NULL,
  actor_user_id uuid NULL,
  actor_via text NOT NULL,
  reason text NOT NULL,
  expected_mutation_count int NOT NULL CHECK (expected_mutation_count >= 0),
  calc_model_version text NOT NULL DEFAULT 'v1',
  effect_no bigint NOT NULL DEFAULT nextval('app_ledger.effect_no_seq'),
  generation int NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','applied','failed','superseded')),
  visible_at timestamptz NULL,
  state_changed_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- mutation tokens (F3: all NOT NULL)
CREATE TABLE app_ledger.effect_projection_mutation (
  mutation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES app_ledger.economic_effect(event_id),
  mutation_seq int NOT NULL,
  target_table text NOT NULL,
  target_row_id uuid NOT NULL,
  op text NOT NULL CHECK (op IN ('insert','update','delete')),
  row_role text NOT NULL,
  expert_id uuid NOT NULL,
  currency text NOT NULL,
  market text NULL,
  instrument_key text NULL,
  qty_delta integer NOT NULL,
  cash_delta numeric NULL,
  cost_delta numeric NOT NULL DEFAULT 0,
  realized_delta numeric NOT NULL DEFAULT 0,
  before_hash text NULL,
  after_hash text NULL,
  consumed boolean NOT NULL DEFAULT false,
  UNIQUE (event_id, mutation_seq),
  CONSTRAINT epm_seq_pos      CHECK (mutation_seq >= 1),
  CONSTRAINT epm_target_ck    CHECK (target_table IN ('trade_records','portfolio_cash_ledger')),
  CONSTRAINT epm_role_ck      CHECK (row_role IN ('open_position','closed_lot','cash_leg')),
  CONSTRAINT epm_cash_ck      CHECK ((row_role='cash_leg') = (target_table='portfolio_cash_ledger')),
  CONSTRAINT epm_cashdelta_ck CHECK ((row_role='cash_leg') = (cash_delta IS NOT NULL)),
  CONSTRAINT epm_cash_qty_ck  CHECK (row_role <> 'cash_leg' OR qty_delta = 0),
  CONSTRAINT epm_market_ck    CHECK ((row_role = 'cash_leg') = (market IS NULL)),
  CONSTRAINT epm_ikey_ck      CHECK ((row_role = 'cash_leg') = (instrument_key IS NULL)),
  CONSTRAINT epm_before_ck    CHECK ((op='insert') = (before_hash IS NULL)),
  CONSTRAINT epm_after_ck     CHECK ((op='delete') = (after_hash IS NULL))
);

-- ---------------------------------------------------------------- internal cash ledger
CREATE TABLE app_ledger.portfolio_cash_ledger (
  cash_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency IN ('TWD','USD')),
  entry_kind text NOT NULL CHECK (entry_kind IN
    ('trade_settlement','external_capital_flow','data_correction_adjustment')),
  amount numeric NOT NULL,
  effective_at timestamptz NOT NULL,
  event_id uuid NOT NULL REFERENCES app_ledger.economic_effect(event_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- review chain (F3)
CREATE TABLE app_ledger.effect_review_event (
  review_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_effect_id uuid NOT NULL,
  review_no bigint NOT NULL,
  review_state text NOT NULL CHECK (review_state IN ('manual_review','cleared','quarantined')),
  reason text NOT NULL,
  actor_user_id uuid NULL,
  actor_via text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ere_unique UNIQUE (logical_effect_id, review_no),
  CONSTRAINT ere_no_pos CHECK (review_no >= 1)
);

CREATE VIEW app_ledger.effect_review_current AS
  SELECT DISTINCT ON (logical_effect_id) *
  FROM app_ledger.effect_review_event
  ORDER BY logical_effect_id, review_no DESC;

CREATE OR REPLACE FUNCTION app_ledger.review_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'review_event_append_only' USING ERRCODE='P0001';
END $$;
CREATE TRIGGER trg_review_append_only
  BEFORE UPDATE OR DELETE ON app_ledger.effect_review_event
  FOR EACH ROW EXECUTE FUNCTION app_ledger.review_append_only();

CREATE OR REPLACE FUNCTION app_ledger.canonical_review(
  p_logical uuid, p_state text, p_reason text, p_actor uuid, p_via text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cur text; v_no bigint;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('review:'||p_logical::text, 0));
  SELECT review_state INTO v_cur FROM app_ledger.effect_review_current
   WHERE logical_effect_id = p_logical;
  v_cur := coalesce(v_cur, '(none)');
  IF NOT (
      (v_cur = '(none)'        AND p_state IN ('manual_review','quarantined'))
   OR (v_cur = 'manual_review' AND p_state IN ('cleared','quarantined'))
   OR (v_cur = 'cleared'       AND p_state IN ('manual_review','quarantined'))
   OR (v_cur = 'quarantined'   AND p_state = 'manual_review'))
  THEN RAISE EXCEPTION 'illegal_review_transition: % -> %', v_cur, p_state
       USING ERRCODE='P0001'; END IF;

  SELECT coalesce(pg_catalog.max(review_no),0)+1 INTO v_no
    FROM app_ledger.effect_review_event WHERE logical_effect_id = p_logical;
  INSERT INTO app_ledger.effect_review_event
    (logical_effect_id, review_no, review_state, reason, actor_user_id, actor_via)
  VALUES (p_logical, v_no, p_state, p_reason, p_actor, p_via);
  RETURN v_no;
END $$;

-- ---------------------------------------------------------------- canonical hashes
CREATE OR REPLACE FUNCTION app_ledger.tr_econ_hash(r public.trade_records)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.md5((pg_catalog.to_jsonb(r)
    - 'current_price' - 'price_updated_at' - 'created_at'
    - 'last_event_id' - 'last_projection_mutation_id'
    - 'instrument_key')::text)   -- generated column: derived, never independent input
$$;

CREATE OR REPLACE FUNCTION app_ledger.cash_econ_hash(r app_ledger.portfolio_cash_ledger)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.md5((pg_catalog.to_jsonb(r) - 'created_at')::text)
$$;

-- ---------------------------------------------------------------- trade_records guard (E3/F3)
CREATE OR REPLACE FUNCTION app_ledger.trade_records_economic_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_o jsonb; v_n jsonb; v_before text; v_after text; tok record; v_rowid uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_o := pg_catalog.to_jsonb(OLD) - 'current_price' - 'price_updated_at';
    v_n := pg_catalog.to_jsonb(NEW) - 'current_price' - 'price_updated_at';
    IF v_o = v_n THEN RETURN NEW; END IF;   -- only whitelisted price fast path
    v_before := app_ledger.tr_econ_hash(OLD);
    v_rowid  := OLD.id;
  ELSIF TG_OP = 'INSERT' THEN
    v_before := NULL; v_rowid := NEW.id;
  ELSE
    v_before := app_ledger.tr_econ_hash(OLD); v_rowid := OLD.id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    -- F3: production allows NULL market/currency on legacy rows. Any row the ledger
    -- touches must carry full economic context, else fail closed.
    IF NEW.market IS NULL OR pg_catalog.btrim(NEW.market) = ''
       OR NEW.currency IS NULL OR pg_catalog.btrim(NEW.currency) = ''
       OR NEW.quantity_unit IS NULL THEN
      RAISE EXCEPTION 'null_economic_context: market/currency/quantity_unit required'
        USING ERRCODE='P0001';
    END IF;
    -- guard owns provenance columns: client values are always overwritten
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
   ORDER BY m.mutation_seq
   FOR UPDATE
   LIMIT 1;

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

CREATE TRIGGER trg_trade_records_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.trade_records
  FOR EACH ROW EXECUTE FUNCTION app_ledger.trade_records_economic_guard();

-- ---------------------------------------------------------------- cash ledger guard + append-only
CREATE OR REPLACE FUNCTION app_ledger.cash_ledger_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tok record; v_after text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cash_ledger_append_only' USING ERRCODE='P0001';
  END IF;
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

CREATE TRIGGER trg_cash_ledger_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app_ledger.portfolio_cash_ledger
  FOR EACH ROW EXECUTE FUNCTION app_ledger.cash_ledger_guard();

-- ---------------------------------------------------------------- effect append-only (E4)
CREATE OR REPLACE FUNCTION app_ledger.effect_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'effect_delete_forbidden' USING ERRCODE='P0001'; END IF;
  o := pg_catalog.to_jsonb(OLD) - 'state' - 'visible_at' - 'state_changed_at';
  n := pg_catalog.to_jsonb(NEW) - 'state' - 'visible_at' - 'state_changed_at';
  IF o <> n THEN
    RAISE EXCEPTION 'effect_payload_immutable' USING ERRCODE='P0001'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT ((OLD.state='reserved' AND NEW.state IN ('applied','failed'))
           OR (OLD.state='applied'  AND NEW.state='superseded'))
  THEN RAISE EXCEPTION 'effect_illegal_state_transition: % -> %', OLD.state, NEW.state
       USING ERRCODE='P0001'; END IF;
  IF NEW.visible_at IS DISTINCT FROM OLD.visible_at THEN
    IF OLD.visible_at IS NOT NULL THEN
      RAISE EXCEPTION 'visible_at_immutable_once_set' USING ERRCODE='P0001'; END IF;
    IF NEW.state <> 'applied' THEN
      RAISE EXCEPTION 'publish_requires_applied_state' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_effect_append_only
  BEFORE UPDATE OR DELETE ON app_ledger.economic_effect
  FOR EACH ROW EXECUTE FUNCTION app_ledger.effect_append_only();

-- ---------------------------------------------------------------- closed lot conservation (E1 d)
CREATE OR REPLACE FUNCTION app_ledger.assert_closed_lot_conservation(p_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE e record; v_realized numeric; v_cash numeric; v_cost numeric;
BEGIN
  SELECT * INTO e FROM app_ledger.economic_effect WHERE event_id = p_event;
  SELECT coalesce(pg_catalog.sum(realized_delta),0) INTO v_realized
    FROM app_ledger.effect_projection_mutation WHERE event_id=p_event AND row_role='closed_lot';
  SELECT coalesce(pg_catalog.sum(cost_delta),0) INTO v_cost
    FROM app_ledger.effect_projection_mutation
    WHERE event_id=p_event AND row_role IN ('open_position','closed_lot');
  SELECT coalesce(pg_catalog.sum(cash_delta),0) INTO v_cash
    FROM app_ledger.effect_projection_mutation WHERE event_id=p_event AND row_role='cash_leg';
  -- trade settlement identity: cash = -cost_delta + realized  (fees folded into cash & realized)
  IF e.provenance IN ('signal_execution','historical_fill')
     AND v_cash <> (-1)*v_cost + v_realized THEN
    RAISE EXCEPTION 'closed_lot_conservation_violation: cash=% cost=% realized=%',
      v_cash, v_cost, v_realized USING ERRCODE='P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------- deferred semantic invariant (E1/F3)
CREATE OR REPLACE FUNCTION app_ledger.assert_effect_semantics() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE e record; n int; c int; q_open int; q_closed int; cash_sum numeric;
BEGIN
  SELECT * INTO e FROM app_ledger.economic_effect WHERE event_id = NEW.event_id;
  IF e IS NULL THEN RETURN NULL; END IF;

  SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE consumed) INTO n, c
    FROM app_ledger.effect_projection_mutation WHERE event_id = e.event_id;
  IF n <> e.expected_mutation_count OR c <> n THEN
    RAISE EXCEPTION 'effect_mutation_set_mismatch: expected=% actual=% consumed=%',
      e.expected_mutation_count, n, c USING ERRCODE='P0001'; END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.generate_series(1, n) g
              WHERE NOT EXISTS (SELECT 1 FROM app_ledger.effect_projection_mutation m
                                 WHERE m.event_id=e.event_id AND m.mutation_seq=g))
  THEN RAISE EXCEPTION 'effect_mutation_seq_gap' USING ERRCODE='P0001'; END IF;

  -- (a) context binding, NULL-safe
  IF EXISTS (SELECT 1 FROM app_ledger.effect_projection_mutation m
              WHERE m.event_id = e.event_id
                AND (m.expert_id IS DISTINCT FROM e.expert_id
                  OR m.currency  IS DISTINCT FROM e.currency
                  OR (m.row_role <> 'cash_leg' AND
                      (m.market IS DISTINCT FROM e.market
                    OR m.instrument_key IS DISTINCT FROM e.instrument_key))))
  THEN RAISE EXCEPTION 'effect_token_context_mismatch' USING ERRCODE='P0001'; END IF;

  -- (b) quantity conservation
  SELECT coalesce(pg_catalog.sum(qty_delta) FILTER (WHERE row_role='open_position'),0),
         coalesce(pg_catalog.sum(qty_delta) FILTER (WHERE row_role='closed_lot'),0)
    INTO q_open, q_closed
    FROM app_ledger.effect_projection_mutation WHERE event_id=e.event_id;
  IF q_open <> e.qty_delta THEN
    RAISE EXCEPTION 'open_qty_delta_mismatch: tokens=% event=%', q_open, e.qty_delta
      USING ERRCODE='P0001'; END IF;
  IF e.action IN ('trim','sell','exit') AND q_closed <> 0 AND q_closed <> -q_open THEN
    RAISE EXCEPTION 'closed_lot_reclass_mismatch' USING ERRCODE='P0001'; END IF;

  -- (c) cash conservation
  SELECT coalesce(pg_catalog.sum(cash_delta) FILTER (WHERE row_role='cash_leg'),0) INTO cash_sum
    FROM app_ledger.effect_projection_mutation WHERE event_id=e.event_id;
  IF e.cash_delta IS NULL THEN
    IF cash_sum <> 0 THEN RAISE EXCEPTION 'unexpected_cash_leg' USING ERRCODE='P0001'; END IF;
  ELSIF cash_sum <> e.cash_delta THEN
    RAISE EXCEPTION 'cash_delta_mismatch: tokens=% event=%', cash_sum, e.cash_delta
      USING ERRCODE='P0001'; END IF;

  -- (d) F2 correction semantics: a quantity_adjustment is cash- and P&L-neutral
  IF e.provenance = 'quantity_adjustment' THEN
    IF coalesce(e.cash_delta,0) <> 0 OR cash_sum <> 0 THEN
      RAISE EXCEPTION 'quantity_adjustment_must_be_cash_neutral: event=% tokens=%',
        coalesce(e.cash_delta,0), cash_sum USING ERRCODE='P0001'; END IF;
    IF coalesce((SELECT pg_catalog.sum(realized_delta)
                      FROM app_ledger.effect_projection_mutation
                     WHERE event_id=e.event_id),0) <> 0 THEN
      RAISE EXCEPTION 'quantity_adjustment_must_not_create_pnl' USING ERRCODE='P0001'; END IF;
  END IF;
  -- (e) F2 equity_bridge: cash-only, never a quantity or P&L event
  IF e.provenance = 'equity_bridge' THEN
    IF coalesce(e.qty_delta,0) <> 0 OR q_open <> 0 OR q_closed <> 0 THEN
      RAISE EXCEPTION 'equity_bridge_must_not_move_quantity' USING ERRCODE='P0001'; END IF;
    IF coalesce(e.cash_delta,0) = 0 THEN
      RAISE EXCEPTION 'equity_bridge_requires_cash_delta' USING ERRCODE='P0001'; END IF;
  END IF;

  PERFORM app_ledger.assert_closed_lot_conservation(e.event_id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_effect_semantics
  AFTER INSERT ON app_ledger.economic_effect
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION app_ledger.assert_effect_semantics();

-- ---------------------------------------------------------------- signal delete guard (E5)
CREATE OR REPLACE FUNCTION app_ledger.forbid_delete_applied_signal() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_ledger.economic_effect e
              WHERE e.logical_effect_id = OLD.logical_effect_id
                AND e.state IN ('applied','superseded'))
  THEN RAISE EXCEPTION 'signal_delete_forbidden_after_effect' USING ERRCODE='P0001'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_forbid_delete_applied_signal
  BEFORE DELETE ON public.expert_signals
  FOR EACH ROW EXECUTE FUNCTION app_ledger.forbid_delete_applied_signal();

-- ---------------------------------------------------------------- privilege containment (E6)
REVOKE ALL ON ALL TABLES IN SCHEMA app_ledger FROM anon, authenticated, service_role, PUBLIC;
REVOKE ALL ON SCHEMA app_ledger FROM anon, authenticated, service_role, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.trade_records
  FROM anon, authenticated, service_role, PUBLIC;
GRANT SELECT ON public.trade_records TO authenticated, service_role;
GRANT UPDATE (current_price, price_updated_at) ON public.trade_records TO service_role;
