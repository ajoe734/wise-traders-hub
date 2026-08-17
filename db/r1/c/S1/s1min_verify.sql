-- S1-min verifier. Three sets must stay distinct and the withheld predicate
-- must cover the fail-closed unsafe 36, not only the quantity-drift 26.
DO $$
DECLARE
  v_total int; v_drift26 int; v_nonmatch int; v_nonmatch_withheld int;
  v_withheld int; v_publishable int;
BEGIN
  SELECT count(*) INTO v_total       FROM app_ledger.replay_manifest_key;
  SELECT count(*) INTO v_drift26     FROM app_ledger.replay_manifest_key WHERE in_drift26;
  SELECT count(*) INTO v_nonmatch    FROM app_ledger.replay_manifest_key WHERE class <> 'match';
  SELECT count(*) INTO v_nonmatch_withheld FROM app_ledger.replay_manifest_key
    WHERE class <> 'match' AND public_disposition = 'withheld_incomplete'
      AND review_status = 'manual_review' AND authoritative_qty_shares IS NULL;
  SELECT count(*) INTO v_withheld    FROM app_ledger.replay_manifest_key
    WHERE public_disposition = 'withheld_incomplete';
  SELECT count(*) INTO v_publishable FROM app_ledger.replay_manifest_key
    WHERE public_disposition = 'as_reported_publishable';

  IF v_total   <> 84 THEN RAISE EXCEPTION 'universe != 84 (got %)', v_total; END IF;
  IF v_drift26 <> 26 THEN RAISE EXCEPTION 'quantity drift != 26 (got %)', v_drift26; END IF;
  IF v_nonmatch <> 36 THEN RAISE EXCEPTION 'fail-closed unsafe != 36 (got %)', v_nonmatch; END IF;
  -- withheld must be a SUPERSET of the 36: stored_only/incomplete/other are not
  -- quantity drift but are still never publishable.
  IF v_nonmatch_withheld <> 36 THEN
    RAISE EXCEPTION 'withheld predicate misses unsafe keys (36 expected, % covered)', v_nonmatch_withheld; END IF;
  IF v_withheld < 36 THEN RAISE EXCEPTION 'withheld_count % < 36', v_withheld; END IF;
  IF v_withheld + v_publishable <> 84 THEN RAISE EXCEPTION 'disposition partition broken'; END IF;
  IF v_withheld <> 59 OR v_publishable <> 25 THEN
    RAISE EXCEPTION 'seed disposition drift: withheld=% publishable=%', v_withheld, v_publishable; END IF;

  -- key-level "publishable" is NOT expert-level publishable: with 12 experts at
  -- ready=0 the effective public set is 0.
  IF (SELECT count(*) FROM app_ledger.replay_manifest_key m
        WHERE m.public_disposition = 'as_reported_publishable'
          AND m.expert_handle IN (SELECT jsonb_array_elements_text('[]'::jsonb))) <> 0 THEN
    RAISE EXCEPTION 'expert gate leaked'; END IF;

  -- 6515 invariant: withheld, manual_review, no authoritative quantity.
  IF NOT EXISTS (SELECT 1 FROM app_ledger.replay_manifest_key
                  WHERE instrument = '6515 穎崴' AND review_status = 'manual_review'
                    AND public_disposition = 'withheld_incomplete'
                    AND authoritative_qty_shares IS NULL) THEN
    RAISE EXCEPTION '6515 not withheld'; END IF;

  -- S1-min objects exist, S2 objects must NOT.
  IF to_regclass('public.public_projection_version') IS NULL
     OR to_regclass('public.public_projection_withheld') IS NULL
     OR to_regclass('app_ledger.replay_manifest_key') IS NULL THEN
    RAISE EXCEPTION 'S1-min object missing'; END IF;
  IF to_regclass('app_ledger.effect_key') IS NOT NULL
     OR to_regclass('app_ledger.economic_effect') IS NOT NULL THEN
    RAISE EXCEPTION 'S2 object present in S1-min'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='app_ledger' AND p.proname IN
              ('canonical_publish','canonical_apply_signal','publish_signal_effect','apply_price_update')) THEN
    RAISE EXCEPTION 'S2 writer present in S1-min'; END IF;
  -- no new privilege on any pre-existing object
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE grantee='ledger_owner' AND table_schema='public'
                AND table_name NOT IN ('public_projection_version','public_projection_withheld')) THEN
    RAISE EXCEPTION 'ledger_owner holds a grant on a pre-existing table'; END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname='ledger_owner') THEN
    RAISE EXCEPTION 'ledger_owner must not have BYPASSRLS in S1-min'; END IF;
END $$;
SELECT 'S1MIN_VERIFY_PASS';
