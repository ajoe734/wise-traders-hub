#!/usr/bin/env bash
# S3B C1 supplemental negative fixtures (partial v8 / extra key / wrong type /
# wrong canonical value / non-object). Read-only against production; clone only.
# Usage: db/r1/c/C1/run_clone_negatives.sh <clone-url>
set -uo pipefail
CL=${1:?clone url}
D=db/r1/c/C1
P=0; F=0
ok(){ echo "PASS $1"; P=$((P+1)); }
no(){ echo "FAIL $1 :: $2"; F=$((F+1)); }
q(){ psql "$CL" -At -X -c "$1"; }

snap(){ q "select coalesce((select version::text from public.tw_bsr_sync_config where key='market_batch'),'-')
      ||'|'||coalesce((select md5(config::text) from public.tw_bsr_sync_config where key='market_batch'),'-')
      ||'|'||(select count(*) from public.audit_logs)
      ||'|'||(select count(*) from public.tw_bsr_degrade_events)
      ||'|'||(select count(*) from public.tw_bsr_sync_queue)
      ||'|'||coalesce((select md5(string_agg(id||':'||status||':'||updated_at,',' order by id)) from public.tw_bsr_sync_queue),'-')
      ||'|'||(select count(*) from public.tw_bsr_sync_config_history)"; }

B=$(snap); echo "negatives_baseline=$B"

CANON="jsonb_build_object('admission_blocked',true,'admission_reason','provider_plan_rejected','admission_terminal_code','bsr_provider_unsupported','admission_blocked_at',now(),'admission_run_id',gen_random_uuid()::text,'admission_nonce',gen_random_uuid()::text,'admission_evidence',jsonb_build_object('schema_version',1,'provider','finmind','observed_at','2026-08-17T13:30:58.060Z','http_status',400,'outcome','unsupported_plan','decided_by','s3b_c1_migration'))"

run_case(){
  NAME=$1; FIX=$2
  OUT=$(psql "$CL" -qX <<SQL2 2>&1
BEGIN;
$FIX;
\i $D/part1_cas.sql
ROLLBACK;
SQL2
)
  ERR=$(echo "$OUT" | grep -o 'ERROR:  [a-z0-9_]*' | head -1)
  echo "  fixture: $FIX"
  echo "  exact_error: ${ERR:-<none>}"
  if [ -n "$ERR" ]; then ok "$NAME raised ${ERR#ERROR:  }"; else no "$NAME" "no error raised :: $(echo "$OUT"|tail -3)"; fi
  S=$(snap)
  if [ "$S" = "$B" ]; then ok "$NAME 0 delta / 0 residue after rollback"; else no "$NAME delta" "$S vs $B"; fi
}

echo "== N1 partial v8 (only 3 of 7 admission keys, version bumped) =="
run_case N1_partial_v8 "update public.tw_bsr_sync_config set version=8, config=config||jsonb_build_object('admission_blocked',true,'admission_reason','provider_plan_rejected','admission_terminal_code','bsr_provider_unsupported') where key='market_batch'"

echo "== N2 extra admission key beyond the 7-key contract =="
run_case N2_extra_key "update public.tw_bsr_sync_config set version=8, config=config||$CANON||jsonb_build_object('admission_extra','nope') where key='market_batch'"

echo "== N3 wrong type (admission_blocked as string) =="
run_case N3_wrong_type "update public.tw_bsr_sync_config set version=8, config=config||($CANON||jsonb_build_object('admission_blocked','true')) where key='market_batch'"

echo "== N4 wrong canonical value (UI seg state leaked into terminal_code) =="
run_case N4_wrong_value "update public.tw_bsr_sync_config set version=8, config=config||($CANON||jsonb_build_object('admission_terminal_code','unavailable_unsupported')) where key='market_batch'"

echo "== N5 non-object: json string scalar =="
run_case N5_nonobject_string "update public.tw_bsr_sync_config set config='\"blocked\"'::jsonb where key='market_batch'"

echo "== N6 non-object: json number scalar =="
run_case N6_nonobject_number "update public.tw_bsr_sync_config set config='42'::jsonb where key='market_batch'"

echo "== N7 non-object: json null =="
run_case N7_nonobject_null "update public.tw_bsr_sync_config set config='null'::jsonb where key='market_batch'"

echo "== N8 evidence key missing (6-key evidence contract broken) =="
run_case N8_evidence_missing_key "update public.tw_bsr_sync_config set version=8, config=config||($CANON||jsonb_build_object('admission_evidence',jsonb_build_object('schema_version',1,'provider','finmind'))) where key='market_batch'"

echo "RESULT_NEG pass=$P fail=$F"
[ $F -eq 0 ]
