#!/usr/bin/env bash
# Build 1f Stage A — canonical ⇄ migration 等價驗證 + claim token slot 行為測試
#
# 一切都在 `mktemp -d` 產生的隨機路徑臨時 cluster 內完成：
#   - 不連 production（listen_addresses=''，只有 unix socket）
#   - 不寫 repo（量測結果只寫入 $WORK/measurement.json）
#   - trap cleanup，正常路徑 pg_ctl stop，異常路徑強制清理
#
# 用法：
#   bash scripts/bsr-claim-equivalence.sh
#
# 退出碼：0 = 全綠；非 0 = 任一 gate 失敗。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON="$REPO_ROOT/supabase/tests/fixtures/bsr_claim_planned.sql"
CANON_SHA="$REPO_ROOT/supabase/tests/fixtures/bsr_claim_planned.sha256"
MIGRATION="$REPO_ROOT/supabase/migrations/20260812211500_bsr_claim_token_slot.sql"
TESTFILE="$REPO_ROOT/supabase/tests/bsr_claim_token_slot_test.sql"
SCHEMA_FIXTURE="$REPO_ROOT/supabase/tests/fixtures/bsr_slice_schema.sql"
DBNAME="bsr_claim_eph"
NIX_EXPR='with (import <nixpkgs> {}); postgresql_17'

EPH_UID=1000
EPH_GID=1000

die() { echo "FATAL: $*" >&2; exit 1; }
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSSLMODE || true

asuser() {
  if [ "$(id -u)" -eq 0 ]; then
    setpriv --reuid="$EPH_UID" --regid="$EPH_GID" --clear-groups \
      env HOME=/tmp PATH="$PATH" PGOPTIONS="${PGOPTIONS:-}" "$@"
  else
    env PGOPTIONS="${PGOPTIONS:-}" "$@"
  fi
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/bsr-claim-XXXXXXXXXX")"
chmod 777 "$WORK"
CLUSTER_UP=0
PGBIN=""

cleanup() {
  local rc=$?
  if [ "$CLUSTER_UP" = "1" ] && [ -n "$PGBIN" ]; then
    asuser "$PGBIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 \
      || asuser "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [ -n "${KEEP_WORK:-}" ]; then
    echo "KEEP_WORK set — leaving $WORK"
  else
    cp -f "$WORK/measurement.json" "${MEASUREMENT_OUT:-/dev/null}" 2>/dev/null || true
    rm -rf "$WORK"
  fi
  echo "== cleanup: dir=$([ -d "$WORK" ] && echo 1 || echo 0) exit=$rc"
  exit $rc
}
trap cleanup EXIT

psqlx() {
  PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$WORK" -U postgres -d "$DBNAME" -X -v ON_ERROR_STOP=1 "$@"
}
q() { psqlx -t -A -c "$1"; }

# ---------------------------------------------------------------------------
# 0. 前置檔案檢查 + canonical sha256
# ---------------------------------------------------------------------------
for f in "$CANON" "$CANON_SHA" "$MIGRATION" "$TESTFILE" "$SCHEMA_FIXTURE"; do
  [ -f "$f" ] || die "missing file: $f"
done
echo "==> [0] canonical sha256"
( cd "$(dirname "$CANON")" && sha256sum -c "$(basename "$CANON_SHA")" ) || die "canonical sha256 mismatch"
CANON_SHA_VAL="$(sha256sum "$CANON" | awk '{print $1}')"
echo "    canonical sha256 = $CANON_SHA_VAL"

grep -Eqi '^[[:space:]]*(GRANT|REVOKE|ALTER[[:space:]]+FUNCTION.*OWNER|ALTER[[:space:]]+DATABASE)' "$MIGRATION" \
  && die "migration 含授權/擁有者語句（ACL 屬 production read-back 項目）"
echo "    migration ACL-free: OK"

# ---------------------------------------------------------------------------
# 1. 起臨時 cluster（隨機路徑）
# ---------------------------------------------------------------------------
echo "==> [1] nix build postgresql_17"
PGPKG="$(nix build --impure --no-link --print-out-paths --expr "$NIX_EXPR" | grep -v -- '-man$' | head -1)" \
  || die "nix build failed"
PGBIN="$PGPKG/bin"
[ -x "$PGBIN/initdb" ] || die "no initdb in $PGBIN"

chown -R "$EPH_UID:$EPH_GID" "$WORK" 2>/dev/null || true
asuser "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 >/dev/null
cat >> "$WORK/data/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$WORK'
fsync = off
full_page_writes = off
synchronous_commit = off
max_connections = 30
CONF
asuser "$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" -w start >/dev/null
CLUSTER_UP=1
asuser "$PGBIN/createdb" -h "$WORK" -U postgres "$DBNAME"

echo "==> [1b] isolation guard"
q "SELECT current_database() || '|' || current_user || '|' || coalesce(inet_server_addr()::text,'unix') || '|' || current_setting('unix_socket_directories')"
psqlx <<SQL >/dev/null
DO \$\$
BEGIN
  IF current_database() <> '$DBNAME' THEN RAISE EXCEPTION 'guard: db'; END IF;
  IF inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'guard: not unix-socket-only'; END IF;
  IF current_setting('unix_socket_directories') <> '$WORK' THEN RAISE EXCEPTION 'guard: socket dir'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator')) THEN
    RAISE EXCEPTION 'guard: production role fingerprint';
  END IF;
END \$\$;
SQL
echo "    guard OK (socket=$WORK)"

# ---------------------------------------------------------------------------
# 2. base schema + is_tw_trading_hours（production 現況定義，invariant）
# ---------------------------------------------------------------------------
load_base() {
  psqlx -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
  psqlx -f "$SCHEMA_FIXTURE" >/dev/null
  psqlx >/dev/null <<'SQL'
CREATE OR REPLACE FUNCTION public.is_tw_trading_hours()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Taipei') AS ts)
  SELECT
    EXTRACT(ISODOW FROM ts) BETWEEN 1 AND 5
    AND (
      (EXTRACT(HOUR FROM ts) = 9)
      OR (EXTRACT(HOUR FROM ts) BETWEEN 10 AND 12)
      OR (EXTRACT(HOUR FROM ts) = 13 AND EXTRACT(MINUTE FROM ts) < 30)
    )
  FROM t;
$function$;
SQL
}

sig() { # $1 = function name → 一行 tab 分隔簽名資訊
  q "SELECT md5(p.prosrc) || E'\t' || md5(pg_get_functiondef(p.oid)) || E'\t' ||
            pg_get_function_identity_arguments(p.oid) || E'\t' || pg_get_function_result(p.oid) || E'\t' ||
            p.prosecdef || E'\t' || coalesce(p.proconfig::text,'-') || E'\t' || p.provolatile || E'\t' || l.lanname
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.proname='$1'"
}

echo "==> [2] run1: apply canonical, measure"
load_base
psqlx -f "$CANON" >/dev/null
SIG_CANON_1="$(sig claim_bsr_queue_jobs)"
echo "    $SIG_CANON_1"

echo "==> [3] run2: rebuild base, re-apply canonical, measure"
load_base
psqlx -f "$CANON" >/dev/null
SIG_CANON_2="$(sig claim_bsr_queue_jobs)"
echo "    $SIG_CANON_2"
[ "$SIG_CANON_1" = "$SIG_CANON_2" ] || die "run1/run2 hash 不一致（非決定性）"

echo "==> [4] migration equivalence"
load_base
psqlx -f "$MIGRATION" >/dev/null
SIG_MIG="$(sig claim_bsr_queue_jobs)"
echo "    $SIG_MIG"
if [ "$SIG_CANON_1" != "$SIG_MIG" ]; then
  printf '%s\n' "$SIG_CANON_1" > "$WORK/sig_canonical.txt"
  printf '%s\n' "$SIG_MIG" > "$WORK/sig_migration.txt"
  diff -u "$WORK/sig_canonical.txt" "$WORK/sig_migration.txt" || true
  die "canonical ⇄ migration 不等價"
fi
echo "    EQUIVALENT (prosrc/functiondef/args/ret/secdef/config/volatility/lang 全等)"

POST_PROSRC="$(printf '%s' "$SIG_CANON_1" | cut -f1)"
POST_DEF="$(printf '%s' "$SIG_CANON_1" | cut -f2)"
INV_SIG="$(sig is_tw_trading_hours)"

cat > "$WORK/measurement.json" <<JSON
{
  "stage": "A",
  "approved": false,
  "note": "UNAPPROVED_LOCAL_MEASUREMENT — 需在 Final Plan v6.2 由人工批准後才可寫入 bsr_claim_expected.tsv",
  "measured_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pg_version": "$(q 'SHOW server_version')",
  "canonical_sha256": "$CANON_SHA_VAL",
  "run1": { "prosrc": "$(printf '%s' "$SIG_CANON_1" | cut -f1)", "functiondef": "$(printf '%s' "$SIG_CANON_1" | cut -f2)" },
  "run2": { "prosrc": "$(printf '%s' "$SIG_CANON_2" | cut -f1)", "functiondef": "$(printf '%s' "$SIG_CANON_2" | cut -f2)" },
  "migration": { "prosrc": "$(printf '%s' "$SIG_MIG" | cut -f1)", "functiondef": "$(printf '%s' "$SIG_MIG" | cut -f2)" },
  "is_tw_trading_hours": { "prosrc": "$(printf '%s' "$INV_SIG" | cut -f1)", "functiondef": "$(printf '%s' "$INV_SIG" | cut -f2)" }
}
JSON
echo "==> measurement.json"
cat "$WORK/measurement.json"

# expected.tsv：post 行必須仍是 UNAPPROVED（Stage A 不得自我批准）
EXP="$REPO_ROOT/supabase/tests/fixtures/bsr_claim_expected.tsv"
if [ -f "$EXP" ]; then
  if grep -q '^post' "$EXP" && ! grep -q 'UNAPPROVED_LOCAL_MEASUREMENT' "$EXP"; then
    die "expected.tsv post 行已被填值 — Stage A 禁止自我批准"
  fi
  echo "POST GATE: NOT APPROVED YET（skip post 比對）"
  # pre / invariant 行仍要比對
  grep -q "^inv	is_tw_trading_hours_prosrc	$(printf '%s' "$INV_SIG" | cut -f1)$" "$EXP" \
    || die "invariant is_tw_trading_hours prosrc 不符 expected"
  grep -q "^inv	is_tw_trading_hours_functiondef	$(printf '%s' "$INV_SIG" | cut -f2)$" "$EXP" \
    || die "invariant is_tw_trading_hours functiondef 不符 expected"
  echo "    invariant is_tw_trading_hours: OK"
fi

# ---------------------------------------------------------------------------
# 5. 行為測試（每個 case 前重載 canonical，確保乾淨）
# ---------------------------------------------------------------------------
run_case() { # $1 = tcase, $2 = expect_zero|expect_nonzero, [$3.. extra psql args]
  local tcase="$1"; local expect="$2"; shift 2
  load_base >/dev/null
  psqlx -f "$CANON" >/dev/null
  set +e
  PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$WORK" -U postgres -d "$DBNAME" -X \
    -v ON_ERROR_STOP=1 -v tcase="$tcase" "$@" -f "$TESTFILE" > "$WORK/$tcase.log" 2>&1
  local rc=$?
  set -e
  echo "    case=$tcase exit=$rc (expect $expect)"
  grep -E 'NOTICE|ERROR' "$WORK/$tcase.log" | tail -4 || true
  if [ "$expect" = "expect_zero" ] && [ "$rc" -ne 0 ]; then
    cat "$WORK/$tcase.log"; die "$tcase FAILED"
  fi
  if [ "$expect" = "expect_nonzero" ] && [ "$rc" -eq 0 ]; then
    cat "$WORK/$tcase.log"; die "$tcase 未紅燈 — negative control 無鑑別力"
  fi
  return 0
}

echo "==> [5] positive cases"
run_case t1 expect_zero
run_case t2 expect_zero
run_case t3 expect_zero
run_case t6 expect_zero

echo "==> [5b] T4 concurrency (SKIP LOCKED)"
load_base >/dev/null
psqlx -f "$CANON" >/dev/null
psqlx >/dev/null <<'SQL'
INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
VALUES (8001, 'T8001', current_date, 3, 'pending', now() - interval '30 min', 'quota_recovery_token');
INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
SELECT 8100 + g, 'N' || g, current_date, 1, 'pending', now() - interval '5 min', NULL FROM generate_series(1,5) g;
SQL
PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$WORK" -U postgres -d "$DBNAME" -X -q \
  -c "BEGIN; SELECT id FROM public.tw_bsr_sync_queue WHERE id=8001 FOR UPDATE; SELECT pg_sleep(20); ROLLBACK;" >/dev/null 2>&1 &
HOLDER=$!
waited=0
until [ "$(q "SELECT count(*) FROM pg_locks WHERE locktype='transactionid' AND granted")" -ge 1 ] \
  && [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%FOR UPDATE%' AND state='active' OR query LIKE '%pg_sleep%'")" -ge 1 ]; do
  sleep 1; waited=$((waited+1))
  [ "$waited" -ge 15 ] && { kill "$HOLDER" 2>/dev/null || true; die "lock holder 未在 15s 內取得鎖"; }
done
set +e
PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$WORK" -U postgres -d "$DBNAME" -X \
  -v ON_ERROR_STOP=1 -v tcase=t4 -f "$TESTFILE" > "$WORK/t4.log" 2>&1
RC4=$?
set -e
kill "$HOLDER" 2>/dev/null || true; wait "$HOLDER" 2>/dev/null || true
echo "    case=t4 exit=$RC4 (expect 0, holder waited ${waited}s)"
grep -E 'NOTICE|ERROR' "$WORK/t4.log" | tail -3 || true
[ "$RC4" -eq 0 ] || { cat "$WORK/t4.log"; die "T4 FAILED"; }

echo "==> [5c] T5 branches（counter 在 shell 層，不受 ROLLBACK 影響）"
BRANCH_A=0
BRANCH_B=0
load_base >/dev/null; psqlx -f "$CANON" >/dev/null
set +e
PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$WORK" -U postgres -d "$DBNAME" -X \
  -v ON_ERROR_STOP=1 -v tcase=t5 -v trading=true -f "$TESTFILE" > "$WORK/t5_true.log" 2>&1
RC_A=$?
PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$WORK" -U postgres -d "$DBNAME" -X \
  -v ON_ERROR_STOP=1 -v tcase=t5 -v trading=false -f "$TESTFILE" > "$WORK/t5_false.log" 2>&1
RC_B=$?
set -e
[ "$RC_A" -eq 0 ] && BRANCH_A=1 || { cat "$WORK/t5_true.log"; }
[ "$RC_B" -eq 0 ] && BRANCH_B=1 || { cat "$WORK/t5_false.log"; }
printf 'BRANCH_A=%s\nBRANCH_B=%s\n' "$BRANCH_A" "$BRANCH_B" > "$WORK/t5_counters.txt"
echo "    t5(in_hours) exit=$RC_A / t5(off_hours) exit=$RC_B"
grep -E 'NOTICE' "$WORK/t5_true.log" "$WORK/t5_false.log" | tail -4 || true
cat "$WORK/t5_counters.txt"
[ "$BRANCH_A" -eq 1 ] && [ "$BRANCH_B" -eq 1 ] || die "T5 branch counter 未達 A=1,B=1"
# ROLLBACK 後 is_tw_trading_hours 必須還原
[ "$(sig is_tw_trading_hours)" = "$INV_SIG" ] || die "T5 後 is_tw_trading_hours 未還原"
echo "    is_tw_trading_hours 還原 OK"

echo "==> [6] deterministic negative controls（三者皆須紅燈）"
run_case nc1 expect_nonzero
run_case nc2 expect_nonzero
run_case nc3 expect_nonzero

echo
echo "ALL GREEN — Stage A local freeze"
echo "canonical_sha256=$CANON_SHA_VAL"
echo "post_prosrc=$POST_PROSRC"
echo "post_functiondef=$POST_DEF"
echo "（post hash 為 UNAPPROVED_LOCAL_MEASUREMENT，等 v6.2 人工批准）"
