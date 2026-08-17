#!/usr/bin/env bash
# H-ACL — close the PUBLIC/anon/authenticated EXECUTE holes on the freshness
# writer RPCs, proven on a disposable production-shape clone. Production is
# never contacted; no deploy, no cron, no publish.
#
#   preflight -> restore baseline -> full ACL/def inventory (artifact)
#   -> baseline fingerprint -> apply REVOKE plan
#   -> anon/authenticated denied, service_role worker path still succeeds
#   -> whole-catalog ACL diff limited to the planned signatures
#   -> rollback -> 37 canonical ACL keys / 149 tuples / fingerprint bit-identical
set -Eeuo pipefail

ROOT=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$ROOT"
NAME=${1:-hacl}; PORT=${2:-55997}; OUT=${3:-/tmp/hfresh-$NAME}; BK=db/r1/c/S0/backup
DIR=/tmp/$NAME
RUNID="$NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
START=$(date -u +%FT%T.%3NZ)
mkdir -p "$OUT"; LOG="$OUT/$NAME.log"; : >"$LOG"
exec > >(tee -a "$LOG") 2>&1

FAILS=0; CHECKS=0; SUMMARY_EMITTED=0; STAGE="init"
say(){ echo "$*"; }
chk(){ CHECKS=$((CHECKS+1)); if [ "$1" = "0" ]; then say "  PASS $2"; else FAILS=$((FAILS+1)); say "  FAIL $2 ${3:-}"; fi; }
fail(){ FAILS=$((FAILS+1)); say "  FAIL $*"; }
fatal(){ FAILS=$((FAILS+1)); say "!! FATAL stage=$STAGE: $*"; exit 1; }
on_err(){ local c=$?; say "!! ERR stage=$STAGE line=${BASH_LINENO[0]} cmd=[$BASH_COMMAND] exit=$c"; FAILS=$((FAILS+1)); }
cleanup(){
  local c=$?
  trap - EXIT ERR; set +e
  if [ -d "$DIR/pg" ]; then $ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -m immediate -w stop >/dev/null 2>&1; fi
  mkdir -p "$OUT/$NAME-artifacts"; cp "$DIR"/*.log "$DIR"/*.err "$DIR"/*.fp "$DIR"/*.out "$DIR"/*.diff "$DIR"/*.json "$DIR"/*.txt "$DIR"/*.sql "$OUT/$NAME-artifacts/" 2>/dev/null
  rm -rf "$DIR"
  local BG; BG=$(pgrep -f "port=$PORT" | wc -l)
  local DESTROYED=true; [ -d "$DIR" ] && DESTROYED=false
  [ "$BG" = 0 ] || { FAILS=$((FAILS+1)); say "  FAIL background=$BG"; }
  if [ "$SUMMARY_EMITTED" != "1" ]; then
    FAILS=$((FAILS+1))
    say "!! NO VERIFIER SUMMARY — aborted at stage=$STAGE with exit=$c (this is a FAIL, not a skip)"
  fi
  local END H
  END=$(date -u +%FT%T.%3NZ); H=$(sha256sum "$LOG" | cut -d' ' -f1)
  echo "### RESULT run_id=$RUNID start=$START end=$END stage=$STAGE checks=$CHECKS failures=$FAILS destroyed=$DESTROYED background=$BG log_sha256_pre_result=$H"
  [ "$FAILS" = 0 ] || exit 1
  exit 0
}
stage(){ STAGE=$1; say "== stage $1 start=$(date -u +%FT%T.%3NZ)"; }
stage_end(){ say "== stage $STAGE end=$(date -u +%FT%T.%3NZ) exit=0"; }
trap on_err ERR
trap cleanup EXIT

say "### h-acl run_id=$RUNID start=$START port=$PORT out=$OUT production_touch=none"

############################################################ preflight
stage preflight
if [ -s db/r1/c/H/pgbin.path ]; then PGBIN=$(cat db/r1/c/H/pgbin.path); else PGBIN=$(dirname "$(command -v initdb)"); fi
[ -x "$PGBIN/initdb" ] || fatal "initdb missing in $PGBIN"
export PATH="$PGBIN:$PATH"
[ -f "$PGBIN/../share/postgresql/extension/vector.control" ] || fatal "pgvector control file missing under $PGBIN/../share"
[ -x "$PGBIN/pg_ctl" ] || fatal "pg_ctl missing in $PGBIN"
python3 - "$PORT" <<'PY' || fatal "port $PORT already in use (bind failed)"
import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try: s.bind(("127.0.0.1",int(sys.argv[1])))
except OSError: sys.exit(1)
s.close()
PY
AVAIL_MB=$(df -Pm /tmp | awk 'NR==2{print $4}')
[ "$AVAIL_MB" -ge 2048 ] || fatal "not enough disk on /tmp: ${AVAIL_MB}MB"
[ -f "$BK/MANIFEST.json" ] || fatal "backup manifest missing"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
rm -rf "$DIR"; mkdir -p "$DIR/sock"
ASU=""; if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DIR"; ASU="setpriv --reuid=1000 --regid=1000 --clear-groups"; fi
say "  preflight ok pgbin=$PGBIN disk=${AVAIL_MB}MB port_free=$PORT"
stage_end

############################################################ initdb + start
stage initdb
$ASU "$PGBIN/initdb" -D "$DIR/pg" -U postgres --locale=C -E UTF8 >"$DIR/initdb.log" 2>&1 \
  || { tail -20 "$DIR/initdb.log"; fatal "initdb failed"; }
$ASU "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" \
  -o "-p $PORT -k $DIR/sock -c listen_addresses=127.0.0.1 -c fsync=off -c log_statement=all -c log_min_messages=warning -c log_line_prefix='%m [%p] %u ' " \
  -w -t 60 start >"$DIR/pgctl.log" 2>&1 || { tail -20 "$DIR/pg.log"; fatal "pg_ctl start failed"; }
READY=0
for i in $(seq 1 60); do
  if $ASU "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" -q; then READY=1; break; fi
  sleep 1
done
[ "$READY" = 1 ] || { tail -20 "$DIR/pg.log"; fatal "server never became ready"; }
psql "postgresql://postgres@localhost:$PORT/postgres?sslmode=disable" -qX -c 'create database clone' >/dev/null
CL="postgresql://postgres@localhost:$PORT/clone?sslmode=disable"
ANON="postgresql://anon_l:x@localhost:$PORT/clone?sslmode=disable"
AUTHD="postgresql://auth_l:x@localhost:$PORT/clone?sslmode=disable"
SVC="postgresql://svc_l:x@localhost:$PORT/clone?sslmode=disable"
stage_end

############################################################ restore baseline
stage restore
for f in $(python3 -c "import json;print(' '.join(json.load(open('$BK/MANIFEST.json'))['restore_bundle']['order']))"); do
  psql "$CL" -qX -f "$BK/restore/$f" >>"$DIR/restore.log" 2>&1 || true
done
grep -E '^psql:.*(ERROR|FATAL)' "$DIR/restore.log" | sed -E 's#^psql:[^ ]*/([^/:]+):([0-9]+): #\1:\2 #' | sort >"$DIR/restore_errors.txt" || true
RESTORE_ERR=$(wc -l <"$DIR/restore_errors.txt")
chk $([ "$RESTORE_ERR" = 0 ] && echo 0 || echo 1) "A-01 fresh clone restores with 0 errors (0 unexpected / 0 expected)" "$(head -5 "$DIR/restore_errors.txt")"
set +e
python3 db/r1/c/H/clone_census.py "$CL" >"$DIR/census.txt" 2>&1; CEN=$?
python3 db/r1/c/S0/s0_restore_verify.py "$CL" "$DIR/fidelity.json" >"$DIR/fidelity.log" 2>&1; FID=$?
set -e
chk $CEN "A-02 clone catalog census == production baseline fingerprint" "$(cat "$DIR/census.txt")"
chk $([ "$FID" = 0 ] && echo 0 || echo 1) "A-02b restore fidelity vs baseline artifacts (37 ACL keys / 149 tuples / columns / indexes / constraints / RLS / triggers)" "$(grep ' FAIL' "$DIR/fidelity.log" | head -4)"
# login roles that behave like the PostgREST roles
psql "$CL" -qX -v ON_ERROR_STOP=1 >>"$DIR/setup.log" 2>&1 <<'SQL'
CREATE ROLE anon_l LOGIN PASSWORD 'x' IN ROLE anon;
CREATE ROLE auth_l LOGIN PASSWORD 'x' IN ROLE authenticated;
CREATE ROLE svc_l  LOGIN PASSWORD 'x' IN ROLE service_role;
SQL
stage_end

############################################################ inventory + plan
stage inventory
python3 db/r1/c/H/h_acl_plan.py "$CL" "$DIR" | tee "$DIR/plan.out"
cp "$DIR/h_acl_migrate.sql" "$DIR/h_acl_rollback.sql" "$OUT/" 2>/dev/null || true
INSCOPE=$(python3 -c "import json;print(json.load(open('$DIR/acl_plan.json'))['in_scope'])")
HARD=$(python3 -c "import json;print(len(json.load(open('$DIR/acl_plan.json'))['hardened']))")
KEPT=$(python3 -c "import json;print(len(json.load(open('$DIR/acl_plan.json'))['kept_authenticated']))")
chk $([ "$INSCOPE" -ge 30 ] && echo 0 || echo 1) "A-03 writer inventory captured: in_scope=$INSCOPE hardened=$HARD kept_authenticated=$KEPT (signatures/owner/secdef/search_path/def sha256/current grantees in acl_inventory.json)" "in_scope=$INSCOPE"
# the two signatures the review named must be in the hardened set
for want in 'public.ensure_bsr_queued(p_stock_id text)' 'public.claim_bsr_queue_jobs(_batch integer, _max_priority integer)'; do
  if grep -qF "$want" <(python3 -c "import json;print('\n'.join(json.load(open('$DIR/acl_plan.json'))['hardened']))"); then
    chk 0 "A-04 named hole in hardened set: $want"
  else chk 1 "A-04 named hole missing from hardened set: $want"; fi
done
# whole-catalog ACL snapshot (every relation + every function), before
psql "$CL" -AtqX -f db/r1/c/H/acl_snapshot.sql >"$DIR/acl_before.fp"
psql "$CL" -AtqX -f db/r1/c/H/h5_fingerprint.sql >"$DIR/before.fp"
stage_end

############################################################ pre-migration exposure
stage pre_exposure
PRE_ANON=$(psql "$CL" -AtqX -c "SELECT has_function_privilege('anon','public.ensure_bsr_queued(text)','EXECUTE')")
PRE_PUB=$(psql "$CL" -AtqX -c "SELECT has_function_privilege('public','public.claim_bsr_queue_jobs(integer,integer)','EXECUTE')")
chk $([ "$PRE_ANON" = "t" ] && [ "$PRE_PUB" = "t" ] && echo 0 || echo 1) \
    "A-05 baseline reproduces the reported exposure (anon can EXECUTE ensure_bsr_queued, PUBLIC can EXECUTE claim_bsr_queue_jobs)" "anon=$PRE_ANON public=$PRE_PUB"
stage_end

############################################################ apply
stage apply
psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/h_acl_migrate.sql" >"$DIR/apply.log" 2>&1
POST=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f' AND p.provolatile='v'
    AND p.proname ~ '(bsr|chip|rollup|queue|backfill|enqueue|claim|prefetch|finmind|converge|materialize|institutional)'
    AND (has_function_privilege('public',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE'))")
chk $([ "$POST" = 0 ] && echo 0 || echo 1) "A-06 after migrate: 0 freshness writers executable by PUBLIC or anon" "left=$POST"
AUTHLEFT=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f' AND p.provolatile='v'
    AND p.proname ~ '(bsr|chip|rollup|queue|backfill|enqueue|claim|prefetch|finmind|converge|materialize|institutional)'
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')")
# Function ACL is what the migration deliberately changes; every other section
# of the fingerprint (relfilenodes, table ACL, function bodies, triggers, chips
# data hash / rowcounts / max(updated_at)) must be untouched.
psql "$CL" -AtqX -f db/r1/c/H/h5_fingerprint.sql | grep -v '^baseline_function_acl' >"$DIR/after_migrate.fp"
grep -v '^baseline_function_acl' "$DIR/before.fp" >"$DIR/before_nonacl.fp"
if diff -u "$DIR/before_nonacl.fp" "$DIR/after_migrate.fp" >"$DIR/migrate_fp.diff"; then
  chk 0 "A-12 migrate changed function ACL only: data hash / rowcounts / relfilenodes / table ACL / function bodies / triggers all unchanged"
else chk 1 "A-12 migrate touched more than ACL" "$(cat "$DIR/migrate_fp.diff")"; fi
chk $([ "$AUTHLEFT" = "$KEPT" ] && echo 0 || echo 1) "A-07 after migrate: only the $KEPT keep-list signatures remain reachable by authenticated" "left=$AUTHLEFT"
stage_end

############################################################ denial / worker proofs
stage behaviour
den(){ # role_conn label sql
  if psql "$1" -qX -c "$3" >>"$DIR/deny.out" 2>>"$DIR/deny.err"; then fail "A-08 $2 was NOT denied: $3"
  else CHECKS=$((CHECKS+1)); say "  PASS A-08 denied for $2: ${3:0:52}..."; fi; }
for conn_label in "$ANON|anon" "$AUTHD|authenticated"; do
  C=${conn_label%%|*}; L=${conn_label##*|}
  den "$C" "$L" "SELECT public.ensure_bsr_queued('2330')"
  den "$C" "$L" "SELECT public.claim_bsr_queue_jobs(1,9)"
  den "$C" "$L" "SELECT public.converge_bsr_windows(1,1,1)"
  den "$C" "$L" "SELECT public.materialize_bsr_daily_from_fact(current_date)"
  den "$C" "$L" "SELECT public.finmind_admit_v2('bsr','x','2330',1,true)"
  den "$C" "$L" "SELECT public.bsr_snapshot_mark(current_date,'ready','x',1,1,null)"
  den "$C" "$L" "SELECT public.finmind_pool_reset()"
done
# service_role (the v2 worker path) must still work end to end
: >"$DIR/svc.err"
svc(){ if psql "$SVC" -AtqX -c "$1" >>"$DIR/svc.out" 2>>"$DIR/svc.err"; then CHECKS=$((CHECKS+1)); say "  PASS A-09 service_role still executes: ${1:0:52}..."; else fail "A-09 service_role blocked: $1"; fi; }
svc "SELECT public.ensure_bsr_queued('2330')"
svc "SELECT count(*) FROM public.claim_bsr_queue_jobs(1,9)"
svc "SELECT public.finmind_inflight_acquire('k','2330','bsr')"
svc "SELECT public.finmind_inflight_release('k')"
svc "SELECT public.materialize_bsr_daily_from_fact(current_date, ARRAY['2330'])"
svc "SELECT public.finmind_pool_reset()"
# The browser keep-list must keep its EXECUTE privilege. Without a JWT the clone
# cannot satisfy the function's own auth.uid() guard, so the accepted outcomes
# are: success, or the in-body guard error — never "permission denied".
AUTHPRIV=$(psql "$CL" -AtqX -c "SELECT has_function_privilege('authenticated','public.enqueue_bsr_backfill(text,integer)','EXECUTE')")
A10ERR=$(psql "$AUTHD" -AtqX -c "SELECT public.enqueue_bsr_backfill('2330',5)" 2>&1 >>"$DIR/svc.out" || true)
case "$A10ERR" in *"permission denied"*) A10=1 ;; *) A10=0 ;; esac
[ "$AUTHPRIV" = "t" ] || A10=1
chk $A10 "A-10 keep-list intact: authenticated keeps EXECUTE on the drawer backfill RPC (denial, if any, comes from the function's own guard, not the ACL)" "priv=$AUTHPRIV err=${A10ERR:-none}"
stage_end

############################################################ blast radius
stage blast_radius
psql "$CL" -AtqX -f db/r1/c/H/acl_snapshot.sql >"$DIR/acl_after.fp"
diff "$DIR/acl_before.fp" "$DIR/acl_after.fp" >"$DIR/acl_change.diff" || true
UNPLANNED=$(python3 db/r1/c/H/h_acl_blast.py "$DIR/acl_change.diff" "$DIR/acl_plan.json")
chk $([ "$UNPLANNED" = "0" ] && echo 0 || echo 1) "A-11 ACL changes confined to the planned signatures (0 unplanned relation/function ACL drift)" "unplanned=$UNPLANNED"
stage_end


############################################################ guarded v2 (finmind_pool_reset)
stage guarded_v2
psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/h_acl_v2.sql" >"$DIR/v2_apply.log" 2>&1
V2PRIV=$(psql "$CL" -AtqX -c "SELECT has_function_privilege('authenticated','public.finmind_pool_reset_v2()','EXECUTE')||'/'||has_function_privilege('anon','public.finmind_pool_reset_v2()','EXECUTE')||'/'||has_function_privilege('service_role','public.finmind_pool_reset_v2()','EXECUTE')")
chk $([ "$V2PRIV" = "t/f/t" ] || [ "$V2PRIV" = "true/false/true" ] && echo 0 || echo 1) "A-16 finmind_pool_reset_v2 grants = authenticated+service_role only (anon denied)" "priv=$V2PRIV"

# plain authenticated (no company_admin row) must hit the in-body guard.
# Uses the real non-superuser login role auth_l, otherwise superuser membership
# would satisfy the service_role bypass and mask the guard.
PLAIN=$(psql "$AUTHD" -AtqX -v ON_ERROR_STOP=1 \
  -c "SET request.jwt.claims = '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}'" \
  -c "SELECT public.finmind_pool_reset_v2()" 2>&1 >>"$DIR/v2.out" || true)
case "$PLAIN" in *unauthorized*) R1=0 ;; *) R1=1 ;; esac
chk $R1 "A-17 plain authenticated denied by the v2 guard (unauthorized)" "got=${PLAIN:0:140}"

# company_admin must be allowed: seed a synthetic admin, run as auth_l, then remove it
psql "$CL" -qX -v ON_ERROR_STOP=1 >>"$DIR/v2.out" 2>&1 <<'SQL'
INSERT INTO auth.users (id, email, is_sso_user, is_anonymous, created_at, updated_at)
VALUES ('22222222-2222-2222-2222-222222222222','acl-probe@local', false, false, now(), now());
INSERT INTO public.user_roles (user_id, role) VALUES ('22222222-2222-2222-2222-222222222222','company_admin');
SQL
ADM=$(psql "$AUTHD" -AtqX -v ON_ERROR_STOP=1 \
  -c "SET request.jwt.claims = '{\"sub\":\"22222222-2222-2222-2222-222222222222\",\"role\":\"authenticated\"}'" \
  -c "SELECT public.finmind_pool_reset_v2()" 2>&1)
case "$ADM" in *'"ok": true'*|*'"ok":true'*) R2=0 ;; *) R2=1 ;; esac
chk $R2 "A-18 company_admin allowed through the v2 guard" "got=${ADM:0:160}"
psql "$CL" -qX -v ON_ERROR_STOP=1 >>"$DIR/v2.out" 2>&1 <<'SQL'
DELETE FROM public.user_roles WHERE user_id='22222222-2222-2222-2222-222222222222';
DELETE FROM auth.users WHERE id='22222222-2222-2222-2222-222222222222';
SQL

# service_role path
if psql "$SVC" -AtqX -c "SELECT public.finmind_pool_reset_v2()" >>"$DIR/v2.out" 2>>"$DIR/v2.err"; then R3=0; else R3=1; fi
chk $R3 "A-19 service_role allowed on v2" "$(tail -1 "$DIR/v2.err" 2>/dev/null)"

# the legacy unguarded entry point is service_role-only now
LEG=$(psql "$CL" -AtqX -c "SELECT has_function_privilege('anon','public.finmind_pool_reset()','EXECUTE')||'/'||has_function_privilege('authenticated','public.finmind_pool_reset()','EXECUTE')||'/'||has_function_privilege('service_role','public.finmind_pool_reset()','EXECUTE')")
chk $([ "$LEG" = "f/f/t" ] || [ "$LEG" = "false/false/true" ] && echo 0 || echo 1) "A-20 legacy unguarded finmind_pool_reset() converged to service_role-only" "priv=$LEG"

# the other 45 hardened signatures must not regress
REG=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f' AND p.provolatile='v'
    AND p.proname ~ '(bsr|chip|rollup|queue|backfill|enqueue|claim|prefetch|finmind|converge|materialize|institutional)'
    AND p.proname <> 'finmind_pool_reset_v2'
    AND (has_function_privilege('public',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR (has_function_privilege('authenticated',p.oid,'EXECUTE')
          AND 'public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' NOT IN (
             'public.enqueue_bsr_backfill(p_stock_id text, p_days integer)',
             'public.finmind_pool_set_budget(_pool text, _budget integer)')))")
chk $([ "$REG" = "0" ] && echo 0 || echo 1) "A-21 no regression: 0 freshness writers outside the 2-signature keep-list are reachable by public/anon/authenticated" "leaks=$REG"
stage_end

############################################################ rollback
stage rollback
psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/h_acl_v2_rollback.sql" >"$DIR/v2_rollback.log" 2>&1
V2GONE=$(psql "$CL" -AtqX -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='finmind_pool_reset_v2'")
chk $([ "$V2GONE" = "0" ] && echo 0 || echo 1) "A-22 v2 rollback dropped the new function (catalog back to baseline shape)" "left=$V2GONE"
psql "$CL" -qX -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/h_acl_rollback.sql" >"$DIR/rollback.log" 2>&1
psql "$CL" -AtqX -f db/r1/c/H/acl_snapshot.sql >"$DIR/acl_rollback.fp"
if diff -u "$DIR/acl_before.fp" "$DIR/acl_rollback.fp" >"$DIR/rollback_acl.diff"; then
  chk 0 "A-13 rollback restores the whole-catalog ACL snapshot bit-identically"
else chk 1 "A-13 rollback ACL drift" "$(head -12 "$DIR/rollback_acl.diff")"; fi
set +e
python3 db/r1/c/S0/s0_restore_verify.py "$CL" "$DIR/fidelity2.json" >"$DIR/fidelity2.log" 2>&1; FID2=$?
set -e
chk $([ "$FID2" = 0 ] && echo 0 || echo 1) "A-14 post-rollback fidelity: 37 canonical ACL keys / 149 tuples and every other baseline artifact match" "$(grep ' FAIL' "$DIR/fidelity2.log" | head -4)"
POST_ANON=$(psql "$CL" -AtqX -c "SELECT has_function_privilege('anon','public.ensure_bsr_queued(text)','EXECUTE')")
chk $([ "$POST_ANON" = "t" ] && echo 0 || echo 1) "A-15 rollback is a true restore (the baseline hole is back, proving no silent残留 of the migration)" "anon=$POST_ANON"
stage_end

############################################################ summary
if [ "$FAILS" = 0 ]; then say "H_ACL_VERIFY_PASS checks=$CHECKS failures=0"; else say "H_ACL_VERIFY_FAIL checks=$CHECKS failures=$FAILS"; fi
SUMMARY_EMITTED=1
