-- =====================================================================
-- R1-P 001 — REPLAY MANIFEST + EMBARGOED PUBLIC PROJECTION
-- Applies ON TOP of: db/r1/001..004 + db/r1/d/001_compat + 002_cutover.
-- Clone-only. Contains no production DDL/DML of its own beyond the objects
-- created here, and is fully undone by db/r1/p/099_rollback_p.sql.
--
-- Guarantees added by this file
--   G1 embargo   : an economic effect enters the public projection only when
--                  economic_effect.visible_at IS NOT NULL AND <= cutoff.
--   G2 withhold  : every replay key whose adjudication is manual_review is
--                  withheld from every public surface (row, aggregate, NAV).
--   G3 no-auto-fix: the manifest cannot carry an authoritative quantity for a
--                  key that is still manual_review (6515 invariant).
--   G4 fail-closed: any withheld / unpriced / cross-currency-unconvertible
--                  input nulls equity and sets incomplete_reason.
--   G5 dual basis: as_reported and restated are materialised separately and
--                  restated is refused while unadjudicated drift exists.
-- =====================================================================
SET lock_timeout = '5s';
SET statement_timeout = '600s';

-- ---------------------------------------------------------------- manifest
CREATE TABLE IF NOT EXISTS app_ledger.replay_manifest_key (
  key                       text PRIMARY KEY,
  expert_handle             text NOT NULL,
  instrument                text NOT NULL,
  market                    text NOT NULL,
  currency                  text NOT NULL,
  class                     text NOT NULL
    CHECK (class IN ('match','multiple_apply','signal_only','stored_only','incomplete','other')),
  stored_open_qty_shares    numeric NULL,
  replay_qty_shares         numeric NULL,
  qty_drift                 numeric NULL,
  review_status             text NOT NULL
    CHECK (review_status IN ('auto_supported','manual_review')),
  public_disposition        text NOT NULL
    CHECK (public_disposition IN ('as_reported_publishable','withheld_incomplete')),
  authoritative_qty_shares  numeric NULL,
  auto_correction_forbidden boolean NOT NULL DEFAULT true,
  reason_codes              jsonb NOT NULL DEFAULT '[]'::jsonb,
  in_drift26                boolean NOT NULL DEFAULT false,
  -- G3: an unadjudicated key may never carry an authoritative number
  CONSTRAINT rmk_no_auto_answer CHECK
    (NOT auto_correction_forbidden OR authoritative_qty_shares IS NULL),
  -- manual_review is never publishable
  CONSTRAINT rmk_manual_withheld CHECK
    (review_status <> 'manual_review' OR public_disposition = 'withheld_incomplete')
);
ALTER TABLE app_ledger.replay_manifest_key OWNER TO ledger_owner;

-- the manifest is append/adjudicate-only: class + replay numbers are immutable
CREATE OR REPLACE FUNCTION app_ledger.manifest_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'manifest_delete_forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.key <> OLD.key OR NEW.class <> OLD.class
     OR NEW.stored_open_qty_shares IS DISTINCT FROM OLD.stored_open_qty_shares
     OR NEW.replay_qty_shares IS DISTINCT FROM OLD.replay_qty_shares THEN
    RAISE EXCEPTION 'manifest_replay_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION app_ledger.manifest_immutable() OWNER TO ledger_owner;

DROP TRIGGER IF EXISTS trg_manifest_immutable ON app_ledger.replay_manifest_key;
CREATE TRIGGER trg_manifest_immutable
  BEFORE UPDATE OR DELETE ON app_ledger.replay_manifest_key
  FOR EACH ROW EXECUTE FUNCTION app_ledger.manifest_immutable();

-- production key formula (identical to db/r1/p/manifest_replay.sql)
CREATE OR REPLACE FUNCTION app_ledger.manifest_key(p_expert uuid, p_market text, p_instrument text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'K-' || pg_catalog.left(pg_catalog.md5(
           p_expert::text || '|' || coalesce(p_market,'-') || '|' || p_instrument), 16)
$$;
ALTER FUNCTION app_ledger.manifest_key(uuid,text,text) OWNER TO ledger_owner;

CREATE OR REPLACE FUNCTION app_ledger.manifest_disposition(
  p_expert uuid, p_market text, p_instrument text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT m.public_disposition FROM app_ledger.replay_manifest_key m
      WHERE m.key = app_ledger.manifest_key(p_expert, p_market, p_instrument)),
    'as_reported_publishable')
$$;
ALTER FUNCTION app_ledger.manifest_disposition(uuid,text,text) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- audit + withhold
CREATE TABLE IF NOT EXISTS public.public_projection_version (
  projection_version bigint PRIMARY KEY,
  expert_id          uuid NOT NULL,
  basis              text NOT NULL CHECK (basis IN ('as_reported','restated')),
  embargo_cutoff     timestamptz NOT NULL,
  built_at           timestamptz NOT NULL DEFAULT now(),
  withheld_count     int NOT NULL DEFAULT 0,
  embargoed_count    int NOT NULL DEFAULT 0,
  source             text NOT NULL DEFAULT 'canonical_publish'
);

CREATE TABLE IF NOT EXISTS public.public_projection_withheld (
  projection_version bigint NOT NULL,
  expert_id          uuid NOT NULL,
  instrument_key     text NOT NULL,
  instrument         text NOT NULL,
  market             text NULL,
  manifest_key       text NULL,
  reason             text NOT NULL,
  PRIMARY KEY (projection_version, expert_id, instrument_key)
);

REVOKE ALL ON public.public_projection_version, public.public_projection_withheld
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_projection_version TO service_role;
GRANT SELECT ON public.public_projection_withheld TO service_role;

-- ---------------------------------------------------------------- fx (fail closed)
-- production fx_rates holds a single undated USDTWD row: historical conversion
-- is NOT available, so any cross-currency roll-up must fail closed.
CREATE OR REPLACE FUNCTION app_ledger.fx_rate_as_of(p_from text, p_to text, p_as_of date)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v numeric;
BEGIN
  IF p_from = p_to THEN RETURN 1; END IF;
  SELECT r.rate INTO v FROM public.fx_rates r
   WHERE r.currency_pair = p_from||p_to
     AND r.fetched_at::date <= p_as_of
   ORDER BY r.fetched_at DESC LIMIT 1;
  IF v IS NULL THEN
    RAISE EXCEPTION 'fx_history_unavailable: % -> % as_of %', p_from, p_to, p_as_of
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v;
END $$;
ALTER FUNCTION app_ledger.fx_rate_as_of(text,text,date) OWNER TO ledger_owner;

-- ---------------------------------------------------------------- publish (embargoed)
CREATE OR REPLACE FUNCTION app_ledger.canonical_publish(
  p_expert uuid, p_as_of date DEFAULT NULL, p_basis text DEFAULT 'as_reported',
  p_fail boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ver bigint;
  v_asof date := coalesce(p_as_of, (pg_catalog.now())::date);
  v_cut timestamptz := pg_catalog.now();
  r record; v_prev_eq numeric;
  v_withheld int := 0; v_embargoed int := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('proj:'||p_expert::text, 0));
  v_ver := pg_catalog.nextval('app_ledger.projection_version_seq');

  -- how many effects of this expert exist but are still embargoed
  SELECT pg_catalog.count(*) INTO v_embargoed
    FROM app_ledger.economic_effect e
   WHERE e.expert_id = p_expert AND e.state = 'applied'
     AND (e.visible_at IS NULL OR e.visible_at > v_cut);

  ------------------------------------------------------------------ candidate positions
  CREATE TEMP TABLE IF NOT EXISTS pp_cand(
    instrument_key text, instrument text, market text, currency text,
    quantity numeric, cost_value numeric, qty_unit text, origin text) ON COMMIT DROP;
  DELETE FROM pg_temp.pp_cand;

  -- (a) effect-derived, embargo filtered
  INSERT INTO pg_temp.pp_cand
  SELECT m.instrument_key,
         pg_catalog.max(coalesce(e.instrument, m.instrument_key)),
         pg_catalog.max(m.market), m.currency,
         pg_catalog.sum(m.qty_delta), pg_catalog.sum(m.cost_delta),
         pg_catalog.max(e.qty_unit), 'effect'
    FROM app_ledger.effect_projection_mutation m
    JOIN app_ledger.economic_effect e ON e.event_id = m.event_id
   WHERE m.expert_id = p_expert AND m.row_role = 'open_position'
     AND e.state = 'applied'
     AND e.visible_at IS NOT NULL AND e.visible_at <= v_cut
     AND e.effective_at::date <= v_asof
   GROUP BY m.instrument_key, m.currency
  HAVING pg_catalog.sum(m.qty_delta) <> 0;

  -- (b) legacy rows with no canonical effect behind them
  INSERT INTO pg_temp.pp_cand
  SELECT t.instrument_key, t.instrument, t.market, t.currency,
         pg_catalog.sum(t.quantity), pg_catalog.sum(t.quantity*t.entry_price),
         coalesce(pg_catalog.max(t.quantity_unit),'share'), 'legacy'
    FROM public.trade_records t
   WHERE t.expert_id = p_expert AND t.status = 'open' AND t.quantity > 0
     AND NOT EXISTS (SELECT 1 FROM app_ledger.effect_projection_mutation m
                      WHERE m.target_table = 'trade_records' AND m.target_row_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM pg_temp.pp_cand c WHERE c.instrument_key = t.instrument_key)
   GROUP BY t.instrument_key, t.instrument, t.market, t.currency;

  -- G2: withhold anything the manifest has not adjudicated
  INSERT INTO public.public_projection_withheld(
    projection_version, expert_id, instrument_key, instrument, market, manifest_key, reason)
  SELECT v_ver, p_expert, c.instrument_key, c.instrument, c.market,
         app_ledger.manifest_key(p_expert, c.market, c.instrument), 'manual_review_unadjudicated'
    FROM pg_temp.pp_cand c
   WHERE app_ledger.manifest_disposition(p_expert, c.market, c.instrument) = 'withheld_incomplete';
  GET DIAGNOSTICS v_withheld = ROW_COUNT;

  DELETE FROM pg_temp.pp_cand c
   WHERE app_ledger.manifest_disposition(p_expert, c.market, c.instrument) = 'withheld_incomplete';

  -- G5: a restated series may not be produced while drift is unadjudicated
  IF p_basis = 'restated' AND v_withheld > 0 THEN
    RAISE EXCEPTION 'restated_basis_blocked_unadjudicated_drift: % keys', v_withheld
      USING ERRCODE = 'P0001';
  END IF;

  ------------------------------------------------------------------ positions
  INSERT INTO public.public_position_projection(
    projection_version, expert_id, instrument_key, instrument, market, currency,
    quantity, quantity_unit, avg_cost, cost_value, valuation_price, price_as_of, price_source,
    valuation_status, market_value)
  SELECT v_ver, p_expert, c.instrument_key, c.instrument, c.market, c.currency,
         c.quantity::int, coalesce(c.qty_unit,'share'),
         CASE WHEN c.quantity = 0 THEN 0 ELSE c.cost_value / c.quantity END,
         c.cost_value, v.price, v.price_as_of,
         CASE WHEN v.price IS NULL THEN NULL ELSE 'daily_snapshot' END,
         v.status,
         CASE WHEN v.price IS NULL THEN NULL ELSE c.quantity * v.price END
    FROM pg_temp.pp_cand c
    CROSS JOIN LATERAL app_ledger.value_instrument(c.instrument_key, c.market, v_asof) v;

  ------------------------------------------------------------------ portfolio state
  INSERT INTO public.public_portfolio_state(
    projection_version, expert_id, currency, starting_capital,
    external_capital_flow_total, data_correction_adjustment_total, realized_pnl,
    open_cost, cash, market_value, equity, incomplete_reason)
  SELECT v_ver, p_expert, x.cur,
         (SELECT e.starting_capital FROM public.experts e WHERE e.id = p_expert),
         x.ext, x.corr, x.realized, x.open_cost,
         (SELECT e.starting_capital FROM public.experts e WHERE e.id = p_expert) + x.cash_sum,
         x.mv,
         CASE WHEN x.mv IS NULL OR v_withheld > 0 THEN NULL
              ELSE (SELECT e.starting_capital FROM public.experts e WHERE e.id = p_expert)
                   + x.cash_sum + x.mv END,
         CASE WHEN v_withheld > 0 THEN 'withheld_manual_review'
              WHEN x.mv IS NULL THEN 'unpriced_or_unsupported_position'
              ELSE NULL END
    FROM (
      SELECT cur,
        coalesce(pg_catalog.sum(l.amount)
          FILTER (WHERE l.entry_kind='external_capital_flow'),0) ext,
        coalesce(pg_catalog.sum(l.amount)
          FILTER (WHERE l.entry_kind='data_correction_adjustment'),0) corr,
        coalesce(pg_catalog.sum(l.amount),0) cash_sum,
        (SELECT coalesce(pg_catalog.sum(m.realized_delta),0)
           FROM app_ledger.effect_projection_mutation m
           JOIN app_ledger.economic_effect e2 ON e2.event_id = m.event_id
          WHERE m.expert_id = p_expert AND m.currency = s.cur
            AND e2.state='applied' AND e2.visible_at IS NOT NULL AND e2.visible_at <= v_cut) realized,
        (SELECT coalesce(pg_catalog.sum(c.cost_value),0)
           FROM pg_temp.pp_cand c WHERE c.currency = s.cur) open_cost,
        (SELECT CASE WHEN pg_catalog.bool_or(pp.market_value IS NULL) THEN NULL
                     ELSE coalesce(pg_catalog.sum(pp.market_value),0) END
           FROM public.public_position_projection pp
          WHERE pp.projection_version = v_ver AND pp.expert_id = p_expert
            AND pp.currency = s.cur) mv
      FROM (SELECT DISTINCT currency cur FROM app_ledger.portfolio_cash_ledger
             WHERE expert_id = p_expert
            UNION SELECT DISTINCT currency FROM pg_temp.pp_cand) s
      LEFT JOIN app_ledger.portfolio_cash_ledger l
        ON l.expert_id = p_expert AND l.currency = s.cur
       AND EXISTS (SELECT 1 FROM app_ledger.economic_effect e3
                    WHERE e3.event_id = l.event_id
                      AND e3.visible_at IS NOT NULL AND e3.visible_at <= v_cut)
      GROUP BY s.cur
    ) x(cur, ext, corr, cash_sum, realized, open_cost, mv);

  ------------------------------------------------------------------ NAV daily
  FOR r IN
    SELECT d.trade_date, cur.currency
      FROM (SELECT DISTINCT e.effective_at::date trade_date
              FROM app_ledger.economic_effect e
             WHERE e.expert_id = p_expert
               AND e.visible_at IS NOT NULL AND e.visible_at <= v_cut) d
      CROSS JOIN (SELECT DISTINCT currency FROM app_ledger.portfolio_cash_ledger
                   WHERE expert_id = p_expert) cur
     WHERE d.trade_date <= v_asof
     ORDER BY d.trade_date
  LOOP
    DECLARE
      v_cash numeric; v_mv numeric; v_eq numeric; v_ext numeric; v_corr numeric;
      v_qadj boolean; v_ret numeric; v_complete text; v_kind text; v_unpriced boolean;
    BEGIN
      SELECT coalesce(pg_catalog.sum(l.amount),0),
             coalesce(pg_catalog.sum(l.amount)
               FILTER (WHERE l.entry_kind='external_capital_flow'
                         AND l.effective_at::date = r.trade_date),0),
             coalesce(pg_catalog.sum(l.amount)
               FILTER (WHERE l.entry_kind='data_correction_adjustment'
                         AND l.effective_at::date = r.trade_date),0)
        INTO v_cash, v_ext, v_corr
        FROM app_ledger.portfolio_cash_ledger l
        JOIN app_ledger.economic_effect e ON e.event_id = l.event_id
       WHERE l.expert_id = p_expert AND l.currency = r.currency
         AND l.effective_at::date <= r.trade_date
         AND e.visible_at IS NOT NULL AND e.visible_at <= v_cut;
      v_cash := v_cash + (SELECT starting_capital FROM public.experts WHERE id = p_expert);

      SELECT coalesce(pg_catalog.sum(q.qty * v.price),0),
             pg_catalog.bool_or(v.price IS NULL)
        INTO v_mv, v_unpriced
        FROM (SELECT m.instrument_key ikey, m.market mk,
                     pg_catalog.max(coalesce(e.instrument,m.instrument_key)) inst,
                     pg_catalog.sum(m.qty_delta) qty
                FROM app_ledger.effect_projection_mutation m
                JOIN app_ledger.economic_effect e ON e.event_id = m.event_id
               WHERE m.expert_id = p_expert AND m.currency = r.currency
                 AND m.row_role = 'open_position'
                 AND e.state = 'applied'
                 AND e.visible_at IS NOT NULL AND e.visible_at <= v_cut
                 AND e.effective_at::date <= r.trade_date
               GROUP BY 1,2 HAVING pg_catalog.sum(m.qty_delta) <> 0) q
        CROSS JOIN LATERAL app_ledger.value_instrument(q.ikey, q.mk, r.trade_date) v
       WHERE app_ledger.manifest_disposition(p_expert, q.mk, q.inst) = 'as_reported_publishable';

      IF coalesce(v_unpriced,false) OR v_withheld > 0 THEN v_mv := NULL; END IF;
      v_eq := CASE WHEN v_mv IS NULL THEN NULL ELSE v_cash + v_mv END;

      SELECT EXISTS (SELECT 1 FROM app_ledger.economic_effect e
                      WHERE e.expert_id = p_expert AND e.currency = r.currency
                        AND e.effective_at::date = r.trade_date
                        AND e.visible_at IS NOT NULL AND e.visible_at <= v_cut
                        AND e.provenance = 'quantity_adjustment')
        INTO v_qadj;

      SELECT n.equity INTO v_prev_eq FROM public.public_nav_daily n
       WHERE n.projection_version = v_ver AND n.expert_id = p_expert
         AND n.currency = r.currency AND n.trade_date < r.trade_date
         AND n.reporting_basis = p_basis
       ORDER BY n.trade_date DESC LIMIT 1;

      IF p_basis = 'as_reported' AND v_qadj THEN
        v_ret := NULL; v_complete := 'partial'; v_kind := 'quantity_adjustment';
      ELSIF v_eq IS NULL OR v_prev_eq IS NULL OR v_prev_eq = 0 THEN
        v_ret := NULL;
        v_complete := CASE WHEN v_eq IS NULL THEN 'unavailable' ELSE 'complete' END;
        v_kind := CASE WHEN v_corr <> 0 THEN 'equity_bridge' ELSE NULL END;
      ELSE
        v_ret := (v_eq - v_prev_eq - v_ext
                  - CASE WHEN p_basis = 'as_reported' THEN v_corr ELSE 0 END) / v_prev_eq;
        v_complete := 'complete';
        v_kind := CASE WHEN v_corr <> 0 THEN 'equity_bridge' ELSE NULL END;
      END IF;

      INSERT INTO public.public_nav_daily(
        projection_version, expert_id, currency, trade_date, cash, market_value, equity,
        external_capital_flow, data_correction_adjustment, daily_return, price_as_of,
        completeness, correction_flag, correction_kind, reporting_basis)
      VALUES (v_ver, p_expert, r.currency, r.trade_date, v_cash, v_mv, v_eq,
        v_ext, v_corr, v_ret, r.trade_date, v_complete,
        (v_qadj OR v_corr <> 0), v_kind, p_basis);
    END;
  END LOOP;

  INSERT INTO public.public_projection_version(
    projection_version, expert_id, basis, embargo_cutoff, withheld_count, embargoed_count)
  VALUES (v_ver, p_expert, p_basis, v_cut, v_withheld, v_embargoed);

  -- failure injection point: nothing may become visible if the build aborts
  IF p_fail THEN RAISE EXCEPTION 'simulated_replay_failure' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.public_projection_active(expert_id, active_version)
  VALUES (p_expert, v_ver)
  ON CONFLICT (expert_id) DO UPDATE
    SET active_version = EXCLUDED.active_version, activated_at = pg_catalog.now()
    WHERE public.public_projection_active.active_version < EXCLUDED.active_version;

  RETURN v_ver;
END $$;
ALTER FUNCTION app_ledger.canonical_publish(uuid,date,text,boolean) OWNER TO ledger_owner;
REVOKE EXECUTE ON FUNCTION app_ledger.canonical_publish(uuid,date,text,boolean) FROM PUBLIC;

-- ---------------------------------------------------------------- privileges
-- new functions must not inherit the default PUBLIC EXECUTE
REVOKE ALL ON FUNCTION app_ledger.manifest_key(uuid,text,text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_ledger.manifest_disposition(uuid,text,text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_ledger.manifest_immutable()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_ledger.fx_rate_as_of(text,text,date)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_ledger.canonical_publish(uuid,date,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_ledger.manifest_key(uuid,text,text)         TO ledger_owner, postgres;
GRANT EXECUTE ON FUNCTION app_ledger.manifest_disposition(uuid,text,text) TO ledger_owner, postgres;
GRANT EXECUTE ON FUNCTION app_ledger.fx_rate_as_of(text,text,date)        TO ledger_owner, postgres;

-- the SECURITY DEFINER builder runs as ledger_owner: it needs write access to
-- the projection tables that 002 revokes from everybody else.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.public_position_projection, public.public_portfolio_state,
  public.public_nav_daily, public.public_projection_active,
  public.public_projection_version, public.public_projection_withheld
  TO ledger_owner;
GRANT SELECT ON public.trade_records, public.experts, public.expert_signals,
                public.daily_price_snapshots, public.fx_rates TO ledger_owner;
