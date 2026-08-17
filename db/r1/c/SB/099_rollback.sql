-- Stage B v6 rollback: remove every object created by 001_stage_b.sql and
-- restore public.recover_quota_failed_bsr_jobs byte-identical from baseline.
\set ON_ERROR_STOP on

DROP TRIGGER IF EXISTS trg_tw_bsr_sync_queue_admission_gate ON public.tw_bsr_sync_queue;
DROP FUNCTION IF EXISTS public.tw_bsr_sync_queue_admission_gate();
DROP FUNCTION IF EXISTS public.bsr_admission_status();
DROP FUNCTION IF EXISTS public.bsr_block_and_terminalize_claims(uuid, bigint[], timestamptz[], int[], text, jsonb);
DROP FUNCTION IF EXISTS public.bsr_unblock_after_probe(int, text, jsonb, uuid);
DROP SCHEMA IF EXISTS private_bsr CASCADE;

\i db/r1/c/SB/002_recover_baseline.sql
