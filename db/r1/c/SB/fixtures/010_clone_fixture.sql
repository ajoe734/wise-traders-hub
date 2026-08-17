-- =====================================================================
-- CLONE-ONLY REHEARSAL FIXTURE — Stage B v6
--
-- !! NEVER apply this to production. It is not a migration, it is test data.
-- !! It is deliberately kept out of supabase/migrations/ and is only invoked by
-- !! db/r1/c/SB/sb_edge_rehearsal.sh against a disposable clone.
--
-- Why it exists: db/r1/c/S0/backup/MANIFEST.json has
--   restore_bundle.row_data_included = false
-- so a fresh clone has an empty public.tw_bsr_sync_config (no `market_batch`
-- gate row) and empty auth.users / public.user_roles. B10 therefore could only
-- ever observe decision=missing and aborted at admin_auth (see
-- db/r1/c/SB/edge-failure-ledger.md EF-01).
--
-- Everything here runs in ONE transaction and is schema-legal: the seeded
-- market_batch config mirrors the exact production key set (read-only SELECT of
-- production at 2026-08-17, version 7) minus every admission_* field, plus an
-- EXPLICIT open gate (`admission_blocked: false`) and a legal nonce.
-- =====================================================================
\set ON_ERROR_STOP on

BEGIN;

-- ------------------------------------------------------------------ gate row
INSERT INTO public.tw_bsr_sync_config (key, config, version, updated_at, note)
VALUES (
  'market_batch',
  jsonb_build_object(
    'enabled', true,
    'supported', false,
    'threshold_pending', 15,
    'min_stocks_in_response', 500,
    'last_probe_at', NULL,
    'last_probe_error', NULL,
    'last_probe_format', NULL,
    'last_probe_outcome', NULL,
    -- explicit OPEN gate (JSON false, not missing, not malformed)
    'admission_blocked', false,
    'admission_nonce', gen_random_uuid()::text
  ),
  1,
  now(),
  'clone-only rehearsal fixture'
)
ON CONFLICT (key) DO UPDATE
   SET config = EXCLUDED.config, version = 1, updated_at = now();

-- degrade state must exist or bsr_get_degrade_state returns nothing useful
INSERT INTO public.tw_bsr_sync_config (key, config, version, updated_at, note)
VALUES ('degrade:finmind',
        jsonb_build_object('mode','normal','since', now(), 'reason','clone_fixture'),
        1, now(), 'clone-only rehearsal fixture')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------- enqueue input
-- tier2 candidates: institutional rows with no matching tw_bsr_daily row.
-- Chip-eligible 4-digit ids only, on the three most recent weekdays.
INSERT INTO public.tw_institutional_daily (stock_id, trade_date, foreign_net, trust_net, dealer_net, total_net, source)
SELECT s, d, 1000, 0, 0, 1000, 'clone_fixture'
  FROM unnest(ARRAY['1101','1216','2002','2207','2301','2303','2308','2330','2357','2379',
                    '2382','2412','2454','2603','2609','2615','3008','3034','3231','3711']) s
 CROSS JOIN (
   SELECT d::date FROM generate_series(current_date - 6, current_date, '1 day') d
    WHERE extract(isodow FROM d) < 6
 ) w(d)
ON CONFLICT DO NOTHING;

COMMIT;
