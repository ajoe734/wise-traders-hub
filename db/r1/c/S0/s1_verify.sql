DO $$ BEGIN
 IF (SELECT count(*) FROM app_ledger.replay_manifest_key) <> 84 THEN RAISE EXCEPTION 'manifest != 84'; END IF;
 IF (SELECT count(*) FROM app_ledger.replay_manifest_key WHERE in_drift26) <> 26 THEN RAISE EXCEPTION 'drift != 26'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_ledger.replay_manifest_key WHERE instrument='6515 穎崴' AND review_status='manual_review' AND public_disposition='withheld_incomplete' AND authoritative_qty_shares IS NULL) THEN RAISE EXCEPTION '6515 not withheld'; END IF;
 IF to_regclass('app_ledger.effect_key') IS NULL OR to_regclass('public.public_projection_version') IS NULL OR to_regclass('public.public_projection_withheld') IS NULL THEN RAISE EXCEPTION 'S1 object missing'; END IF;
END $$;
SELECT 'S1_VERIFY_PASS';