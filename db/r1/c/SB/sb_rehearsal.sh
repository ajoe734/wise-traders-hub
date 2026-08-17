#!/usr/bin/env bash
# =====================================================================
# Stage B v6 rehearsal on a disposable production-shape clone.
# Usage: db/r1/c/SB/sb_rehearsal.sh <name> <port> [outdir]
# Production is never contacted (PG* unset before anything runs).
# Fail-loud: any unexpected error / missing summary => non-zero exit.
# =====================================================================
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-B6}; PORT=${2:-55801}; OUT=${3:-/tmp/sb-$NAME}
BK=db/r1/c/S0/backup; DIR=/tmp/sb$NAME; HTTP_PORT=${HTTP_PORT:-$((PORT - 52000))}
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
START=$(date -u +%FT%T.%3NZ)
mkdir -p "$OUT"; LOG="$OUT/$NAME.log"; : >"$LOG"
exec > >(tee -a "$LOG") 2>&1

FAILS=0; CHECKS=0; SUMMARY=0; STAGE=init
chk(){ CHECKS=$((CHECKS+1)); if [ "$1" = 0 ]; then echo "  PASS $2"; else FAILS=$((FAILS+1)); echo "  FAIL $2 ${3:-}"; fi; }
fatal(){ FAILS=$((FAILS+1)); echo "!! FATAL stage=$STAGE: $*"; exit 1; }
stage(){ STAGE=$1; echo "== stage $1 $(date -u +%FT%T.%3NZ)"; }
on_err(){ local c=$?; echo "!! ERR stage=$STAGE line=${BASH_LINENO[0]} cmd=[$BASH_COMMAND] exit=$c"; FAILS=$((FAILS+1)); }
cleanup(){
  local c=$?; trap - EXIT ERR; set +e
  [ -d "$DIR/pg" ] && $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1
  mkdir -p "$OUT/artifacts"; cp "$DIR"/*.txt "$DIR"/*.log "$DIR"/*.out "$OUT/artifacts/" 2>/dev/null
  rm -rf "$DIR"
  local BG; BG=$(pgrep -f "port=$PORT" | wc -l)
  [ "$BG" = 0 ] || { FAILS=$((FAILS+1)); echo "  FAIL background=$BG"; }
  [ "$SUMMARY" = 1 ] || { FAILS=$((FAILS+1)); echo "!! NO VERIFIER SUMMARY — aborted at stage=$STAGE exit=$c (FAIL, not skip)"; }
  local END H; END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG" | cut -d' ' -f1)
  echo "### RESULT run_id=$RUNID start=$START end=$END stage=$STAGE checks=$CHECKS failures=$FAILS destroyed=true background=$BG log_sha256_pre_result=$H"
  [ "$FAILS" = 0 ] || exit 1
  exit 0
}
trap on_err ERR; trap cleanup EXIT
echo "### stage-b rehearsal run_id=$RUNID port=$PORT out=$OUT"

############################################################ preflight
stage preflight
if [ -s db/r1/c/H/pgbin.path ]; then PGBIN=$(cat db/r1/c/H/pgbin.path); else PGBIN=$(dirname "$(command -v initdb)"); fi
[ -x "$PGBIN/initdb" ] || fatal "initdb missing in $PGBIN"
export PATH="$PGBIN:$PATH"
[ -f "$BK/MANIFEST.json" ] || fatal "baseline manifest missing"
python3 - "$PORT" <<'PY' || fatal "port busy"
import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try: s.bind(("127.0.0.1",int(sys.argv[1])))
except OSError: sys.exit(1)
s.close()
PY
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi

############################################################ initdb
stage initdb
$ASU "$PGBIN/initdb" -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 || { tail -20 "$DIR/initdb.log"; fatal initdb; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" \
  -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off -c log_statement=all -c log_min_messages=warning" \
  -w -t 60 start >"$DIR/pgctl.log" 2>&1 || { tail -20 "$DIR/pg.log"; fatal "pg_ctl start"; }
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"

############################################################ restore baseline
stage restore
for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1 || true
done
grep -E '^psql:.*(ERROR|FATAL)' "$DIR/restore.log" | sort >"$DIR/restore_errors.txt" || true
RE=$(wc -l <"$DIR/restore_errors.txt")
chk $([ "$RE" = 0 ] && echo 0 || echo 1) "SB-01 fresh restore 0 errors" "$(head -3 "$DIR/restore_errors.txt")"
set +e; python3 db/r1/c/H/clone_census.py "$CL" >"$DIR/census.txt" 2>&1; CEN=$?; set -e
chk $CEN "SB-02 catalog census == production baseline" "$(tail -3 "$DIR/census.txt")"

############################################################ fingerprint before
stage fingerprint_before
# Comment coverage is only meaningful if a comment actually exists: the exact
# production baseline carries NO comment on any replaced function, so seed a
# deterministic control comment on each replaced target BEFORE the fingerprint
# is taken. Apply and rollback must both preserve it byte-for-byte.
psql "$CL" -qX -v ON_ERROR_STOP=1 >/dev/null <<SQL
COMMENT ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) IS 'sb-comment-control|$RUNID|quota
line2: multi-line + unicode 券商分點';
COMMENT ON FUNCTION public.recover_stale_bsr_queue_jobs(integer, integer) IS 'sb-comment-control|$RUNID|stale';
COMMENT ON FUNCTION public.reap_stale_bsr_queue_jobs(integer) IS 'sb-comment-control|$RUNID|reaper';
SQL
psql "$CL" -qXAt -f db/r1/c/SB/sb_fingerprint.sql | sort >"$DIR/fp_before.txt"
grep -E '^replmeta\|' "$DIR/fp_before.txt" >"$DIR/repl_meta_before.txt"
grep -E '^replbody\|' "$DIR/fp_before.txt" >"$DIR/repl_body_before.txt"
RM=$(wc -l <"$DIR/repl_meta_before.txt")
chk $([ "$RM" = 3 ] && echo 0 || echo 1) "SB-02a replaced-function metadata captured for 3 targets (got $RM)"
grep -c 'comment_md5=NULL' "$DIR/repl_meta_before.txt" >"$DIR/cmt_null.out" || true
chk $([ "$(cat "$DIR/cmt_null.out")" = 0 ] && echo 0 || echo 1) "SB-02b every replaced target carries a non-null comment pre-apply"
# Negative control: the fingerprint must actually detect a comment-only drift.
psql "$CL" -qX -v ON_ERROR_STOP=1 -c "COMMENT ON FUNCTION public.recover_stale_bsr_queue_jobs(integer, integer) IS 'drift-probe'" >/dev/null
psql "$CL" -qXAt -f db/r1/c/SB/sb_fingerprint.sql | sort | grep -E '^replmeta\|' >"$DIR/repl_meta_drift.txt"
diff -u "$DIR/repl_meta_before.txt" "$DIR/repl_meta_drift.txt" >"$DIR/repl_meta_drift.diff" || true
[ -s "$DIR/repl_meta_drift.diff" ]; chk $? "SB-02c negative control: comment-only drift IS detected by the fingerprint"
psql "$CL" -qX -v ON_ERROR_STOP=1 -c "COMMENT ON FUNCTION public.recover_stale_bsr_queue_jobs(integer, integer) IS 'sb-comment-control|$RUNID|stale'" >/dev/null
psql "$CL" -qXAt -f db/r1/c/SB/sb_fingerprint.sql | sort >"$DIR/fp_before.txt"
grep -E '^replmeta\|' "$DIR/fp_before.txt" >"$DIR/repl_meta_restored.txt"
diff -u "$DIR/repl_meta_before.txt" "$DIR/repl_meta_restored.txt" >"$DIR/repl_meta_restore.diff" || true
[ ! -s "$DIR/repl_meta_restore.diff" ]; chk $? "SB-02d negative control reverted: metadata back to pre-probe state" "$(head -6 "$DIR/repl_meta_restore.diff")"
psql "$CL" -qXAt -c "SELECT md5(pg_get_functiondef('public.recover_quota_failed_bsr_jobs(int)'::regprocedure))" >"$DIR/recover_before.md5"
psql "$CL" -qXAt -c "SELECT p.oid::regprocedure||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'-')||'|'||coalesce(array_to_string(p.proconfig,','),'-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
    AND pg_get_functiondef(p.oid) LIKE '%tw_bsr_sync_queue%' ORDER BY 1" >"$DIR/queue_fn_before.txt"
echo "  queue-touching functions captured: $(wc -l <"$DIR/queue_fn_before.txt")"


############################################################ apply
stage apply
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/SB/001_stage_b.sql >"$DIR/apply1.log" 2>&1 || { tail -20 "$DIR/apply1.log"; fatal "001_stage_b apply"; }
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/SB/002_recover_gate_aware.sql >"$DIR/apply2.log" 2>&1 || { tail -20 "$DIR/apply2.log"; fatal "002 apply"; }
chk 0 "SB-03 migrations applied with ON_ERROR_STOP"
# --- post-apply: metadata/comment must be 100% invariant, body may differ ----
psql "$CL" -qXAt -f db/r1/c/SB/sb_fingerprint.sql | sort >"$DIR/fp_apply.txt"
grep -E '^replmeta\|' "$DIR/fp_apply.txt" >"$DIR/repl_meta_apply.txt"
grep -E '^replbody\|' "$DIR/fp_apply.txt" >"$DIR/repl_body_apply.txt"
diff -u "$DIR/repl_meta_before.txt" "$DIR/repl_meta_apply.txt" >"$DIR/repl_meta_apply.diff" || true
[ ! -s "$DIR/repl_meta_apply.diff" ]; chk $? "SB-03a post-apply replaced-function metadata+comment 100% identical (owner/acl/proconfig/provolatile/prosecdef/leakproof/strict/lang/identity-args/comment)" "$(head -12 "$DIR/repl_meta_apply.diff")"
diff -u "$DIR/repl_body_before.txt" "$DIR/repl_body_apply.txt" >"$DIR/repl_body_apply.diff" || true
BODYCH=$(grep -cE '^\+replbody\|' "$DIR/repl_body_apply.diff" || true)
chk $([ "$BODYCH" = 2 ] && echo 0 || echo 1) "SB-03b post-apply exactly 2 function bodies changed (recover_quota_failed/recover_stale), got $BODYCH"
grep -E '^\+replbody' "$DIR/repl_body_apply.diff" | grep -q 'reap_stale_bsr_queue_jobs' && REAPCH=1 || REAPCH=0
chk $REAPCH "SB-03c reap_stale_bsr_queue_jobs body untouched by apply"

psql "$CL" -qXAt -c "SELECT p.oid::regprocedure||'|secdef='||p.prosecdef::text||'|vol='||p.provolatile::text||'|cfg='||coalesce(array_to_string(p.proconfig,','),'-')||'|owner='||pg_get_userbyid(p.proowner)||'|acl='||coalesce(p.proacl::text,'-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private_bsr') OR (n.nspname='public' AND p.proname IN
   ('bsr_admission_status','bsr_block_and_terminalize_claims','bsr_unblock_after_probe','tw_bsr_sync_queue_admission_gate'))
 ORDER BY 1" >"$DIR/wrapper_catalog.txt"
cat "$DIR/wrapper_catalog.txt"

############################################################ service-role reachability
stage reachability
psql "$CL" -qXAt >"$DIR/rolecheck.out" 2>&1 <<'SQL'
SET ROLE service_role;
SELECT 'service_role_status='||(public.bsr_admission_status() IS NOT NULL);
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN PERFORM public.bsr_admission_status(); RAISE NOTICE 'anon_ok=UNEXPECTED';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'anon_denied=1'; END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN PERFORM public.bsr_admission_status(); RAISE NOTICE 'auth_ok=UNEXPECTED';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'auth_denied=1'; END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN PERFORM private_bsr.gate_blocked(); RAISE NOTICE 'private_reachable=UNEXPECTED';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'private_denied=1';
         WHEN invalid_schema_name THEN RAISE NOTICE 'private_denied=1'; END $$;
RESET ROLE;
SQL
grep -q 'service_role_status=t' "$DIR/rolecheck.out"; chk $? "SB-04a service_role can call wrappers"
grep -q 'anon_denied=1' "$DIR/rolecheck.out"; chk $? "SB-04b anon denied"
grep -q 'auth_denied=1' "$DIR/rolecheck.out"; chk $? "SB-04c authenticated denied"
grep -q 'private_denied=1' "$DIR/rolecheck.out"; chk $? "SB-04d private_bsr unreachable by service_role"


############################################################ SQL verifier
stage verify
set +e
psql "$CL" -qXAt -f db/r1/c/SB/sb_verify.sql >"$DIR/verify.out" 2>&1
set -e
grep -E '^(PASS|FAIL|GAP) ' "$DIR/verify.out" || true
SUM=$(grep '^SUMMARY' "$DIR/verify.out" || true)
[ -n "$SUM" ] || fatal "verifier produced no summary"
echo "  $SUM"
VF=$(echo "$SUM" | sed -E 's/.*fail=([0-9]+).*/\1/')
chk $([ "$VF" = 0 ] && echo 0 || echo 1) "SB-05 sql verifier fail=0" "$SUM"
VP=$(echo "$SUM" | sed -E 's/.*pass=([0-9]+).*/\1/')
chk $([ "$VP" -ge 30 ] && echo 0 || echo 1) "SB-06 verifier coverage >=30 checks (got $VP)"

############################################################ real HTTP proof
stage http_proof
PGREST=$(command -v postgrest || true)
[ -n "$PGREST" ] || PGREST=$(ls -d /nix/store/*postgrest*-bin/bin/postgrest 2>/dev/null | head -1 || true)
if [ -n "$PGREST" ]; then
  set +e
  PGRST_BIN="$PGREST" db/r1/c/SB/sb_postgrest_proof.sh "$CL" "$HTTP_PORT" "$DIR/http" >"$DIR/http_proof.log" 2>&1
  HRC=$?
  set -e
  grep -E '^(PASS|FAIL|HTTP SUMMARY|JS SUMMARY)' "$DIR/http_proof.log" || tail -20 "$DIR/http_proof.log"
  chk $HRC "SB-04e real PostgREST HTTP + supabase-js proof (service_role 200, anon/authenticated 42501, private_bsr unreachable)"
else
  chk 1 "SB-04e postgrest binary unavailable - real HTTP proof NOT executed (GAP, not pass)"
fi

############################################################ two-session barrier
stage barrier
psql "$CL" -qX -c "UPDATE public.tw_bsr_sync_config SET config = config || '{\"admission_blocked\": false}'::jsonb WHERE key='market_batch'" >/dev/null
# session A: hold the gate row lock inside an open transaction, then block.
( psql "$CL" -qXAt <<'SQL'
BEGIN;
SELECT pg_sleep(0.2);
SELECT public.bsr_block_and_terminalize_claims(gen_random_uuid(), ARRAY[]::bigint[],
  ARRAY[]::timestamptz[], ARRAY[]::int[], 'finmind_admission_provider_plan_rejected',
  '{"http_status":400}'::jsonb) ->> 'transition';
SELECT pg_sleep(1.5);
COMMIT;
SQL
) >"$DIR/barrierA.out" 2>&1 &
APID=$!
sleep 0.6
# session B: concurrent insert must serialize on the gate row and land on the
# post-commit side (skipped), or pre-commit side (inserted) — never torn.
psql "$CL" -qXAt >"$DIR/barrierB.out" 2>&1 <<'SQL'
SELECT 'before='||count(*) FROM public.tw_bsr_sync_queue WHERE stock_id='9401';
INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by)
VALUES ('9401', current_date - 9, 1, 'pending', 'barrier_probe');
SELECT 'after='||count(*) FROM public.tw_bsr_sync_queue WHERE stock_id='9401';
SQL
wait $APID || true
cat "$DIR/barrierA.out" "$DIR/barrierB.out"
grep -q 'blocked' "$DIR/barrierA.out"; chk $? "SB-07a session A committed the block transition"
AFTER=$(grep -o 'after=[01]' "$DIR/barrierB.out" | tail -1)
BLK=$(psql "$CL" -qXAt -c "SELECT public.bsr_admission_status()->>'blocked'")
if [ "$BLK" = "true" ] && [ "$AFTER" = "after=0" ]; then chk 0 "SB-07b session B serialized behind the lock and was refused ($AFTER)";
elif [ "$AFTER" = "after=1" ]; then chk 0 "SB-07b session B committed before the gate closed ($AFTER, linearizable)";
else chk 1 "SB-07b torn barrier result" "$AFTER blocked=$BLK"; fi
# deadlock / statement timeout probe on the gate path
psql "$CL" -qXAt -c "SET statement_timeout='2s'; INSERT INTO public.tw_bsr_sync_queue(stock_id,trade_date,priority,status,enqueued_by) VALUES ('9402',current_date-11,1,'pending','timeout_probe'); SELECT 'timeout_probe_done'" >"$DIR/timeout.out" 2>&1 || true
grep -q 'timeout_probe_done' "$DIR/timeout.out"; chk $? "SB-07c gate path completes under 2s statement_timeout"

############################################################ per-chunk blocked accounting vs full-table delta
stage chunk_accounting
psql "$CL" -qX -c "SELECT public.bsr_admission_status()" >/dev/null
psql "$CL" -qXAt >"$DIR/chunk.out" 2>&1 <<'SQL'
-- gate is blocked here. "chunk" of 5 candidates -> inserted must be 0.
CREATE TEMP TABLE cand(stock_id text, trade_date date);
INSERT INTO cand SELECT '95'||lpad(i::text,2,'0'), current_date - i FROM generate_series(1,5) i;
WITH ins AS (
  INSERT INTO public.tw_bsr_sync_queue(stock_id, trade_date, priority, status, enqueued_by)
  SELECT stock_id, trade_date, 2, 'pending', 'chunk_probe' FROM cand RETURNING 1)
SELECT 'candidates=5 inserted='||count(*)||' blocked='||(5-count(*)) FROM ins;
SQL
cat "$DIR/chunk.out"
grep -q 'candidates=5 inserted=0 blocked=5' "$DIR/chunk.out"; chk $? "SB-08a per-chunk blocked = candidates - inserted (5)"
# concurrent unrelated writer pollutes the full-table delta but not the per-chunk count
psql "$CL" -qX -c "UPDATE public.tw_bsr_sync_config SET config = config || '{\"admission_blocked\": false}'::jsonb WHERE key='market_batch'" >/dev/null
C0=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue")
( psql "$CL" -qX -c "INSERT INTO public.tw_bsr_sync_queue(stock_id,trade_date,priority,status,enqueued_by) SELECT '96'||lpad(i::text,2,'0'), current_date - i, 3, 'pending','other_session' FROM generate_series(1,7) i" >/dev/null ) &
OPID=$!
CHUNK=$(psql "$CL" -qXAt -c "WITH ins AS (INSERT INTO public.tw_bsr_sync_queue(stock_id,trade_date,priority,status,enqueued_by) SELECT '97'||lpad(i::text,2,'0'), current_date - i, 2,'pending','chunk_probe2' FROM generate_series(1,4) i RETURNING 1) SELECT count(*) FROM ins")
wait $OPID
C1=$(psql "$CL" -qXAt -c "SELECT count(*) FROM public.tw_bsr_sync_queue")
DELTA=$((C1-C0))
chk $([ "$CHUNK" = 4 ] && echo 0 || echo 1) "SB-08b per-chunk inserted=4 unaffected by concurrent session (got $CHUNK)"
chk $([ "$DELTA" != 4 ] && echo 0 || echo 1) "SB-08c full-table delta polluted ($DELTA != 4) — proves delta accounting is wrong"

############################################################ fuzz
stage fuzz
psql "$CL" -qXAt >"$DIR/fuzz.out" 2>&1 <<'SQL'
DO $$
DECLARE i int; e text; ok int := 0; blowups int := 0;
BEGIN
  FOR i IN 1..200 LOOP
    BEGIN
      PERFORM public.bsr_block_and_terminalize_claims(
        gen_random_uuid(),
        CASE WHEN i%3=0 THEN NULL ELSE ARRAY[(random()*100000)::bigint] END,
        CASE WHEN i%3=0 THEN NULL ELSE ARRAY[now() - (i||' min')::interval] END,
        CASE WHEN i%3=0 THEN NULL ELSE ARRAY[i%9] END,
        CASE WHEN i%7=0 THEN 'bogus_code' ELSE 'finmind_admission_provider_plan_rejected' END,
        CASE WHEN i%5=0 THEN jsonb_build_object('token','leak') ELSE jsonb_build_object('http_status',400,'iter',i) END);
      ok := ok + 1;
    EXCEPTION
      WHEN others THEN
        e := SQLERRM;
        IF e !~ '(terminal_code_not_allowed|claim_arrays_null|length_mismatch|batch_too_large|evidence_key_forbidden|evidence_must_be_object)'
          THEN blowups := blowups + 1; RAISE NOTICE 'unexpected: %', e; END IF;
    END;
  END LOOP;
  RAISE NOTICE 'fuzz ok=% unexpected=%', ok, blowups;
END $$;
SQL
cat "$DIR/fuzz.out"
grep -q 'unexpected=0' "$DIR/fuzz.out"; chk $? "SB-09 200-iteration fuzz: only allowlisted validation errors"

############################################################ rollback
stage rollback
psql "$CL" -qX -v ON_ERROR_STOP=1 -f db/r1/c/SB/099_rollback.sql >"$DIR/rollback.log" 2>&1 || { tail -20 "$DIR/rollback.log"; fatal rollback; }
psql "$CL" -qXAt -c "SELECT md5(pg_get_functiondef('public.recover_quota_failed_bsr_jobs(int)'::regprocedure))" >"$DIR/recover_after.md5"
diff -q "$DIR/recover_before.md5" "$DIR/recover_after.md5" >/dev/null; chk $? "SB-10a recover_quota_failed_bsr_jobs byte-identical after rollback"
psql "$CL" -qXAt -c "SELECT count(*) FROM pg_namespace WHERE nspname='private_bsr'" >"$DIR/nsp.out"
[ "$(cat "$DIR/nsp.out")" = 0 ]; chk $? "SB-10b private_bsr dropped"
psql "$CL" -qXAt -c "SELECT count(*) FROM pg_trigger WHERE tgname='trg_tw_bsr_sync_queue_admission_gate'" >"$DIR/trg.out"
[ "$(cat "$DIR/trg.out")" = 0 ]; chk $? "SB-10c gate trigger dropped"
psql "$CL" -qXAt -c "SELECT p.oid::regprocedure||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'-')||'|'||coalesce(array_to_string(p.proconfig,','),'-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
    AND pg_get_functiondef(p.oid) LIKE '%tw_bsr_sync_queue%' ORDER BY 1" >"$DIR/queue_fn_after.txt"
diff -u "$DIR/queue_fn_before.txt" "$DIR/queue_fn_after.txt" >"$DIR/queue_fn.diff" || true
[ ! -s "$DIR/queue_fn.diff" ]; chk $? "SB-10d queue-touching functions: 0 owner/acl/config drift" "$(head -6 "$DIR/queue_fn.diff")"
psql "$CL" -qXAt -f db/r1/c/SB/sb_fingerprint.sql | sort >"$DIR/fp_after.txt"
grep -E '^(fn|trg|nsp)\|' "$DIR/fp_before.txt" >"$DIR/fp_before_cat.txt"
grep -E '^(fn|trg|nsp)\|' "$DIR/fp_after.txt"  >"$DIR/fp_after_cat.txt"
diff -u "$DIR/fp_before_cat.txt" "$DIR/fp_after_cat.txt" >"$DIR/fp_cat.diff" || true
[ ! -s "$DIR/fp_cat.diff" ]; chk $? "SB-10e catalog fingerprint back to pre-apply baseline" "$(head -6 "$DIR/fp_cat.diff")"

############################################################ artifacts
stage artifacts
mkdir -p "$OUT/artifacts"
cp "$DIR"/*.txt "$DIR"/*.out "$DIR"/*.md5 "$DIR"/*.diff "$DIR"/*.log "$OUT/artifacts/" 2>/dev/null || true
( cd "$OUT/artifacts" && sha256sum ./* >"../SHA256SUMS.txt" ) || true
SUMMARY=1
echo "### VERIFIER SUMMARY $NAME checks=$CHECKS failures=$FAILS sql_verifier=[$SUM]"
