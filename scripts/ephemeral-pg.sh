#!/usr/bin/env bash
# Build 1d — ephemeral PostgreSQL harness（Tier B-write 專用）
#
# 為什麼不是 `supabase db start`：本環境沒有 Docker（/var/run/docker.sock 不存在），
# 也沒有 Supabase CLI。改用本機 PostgreSQL 17 二進位在 /tmp 起一個
# 「只開 unix socket、用完即銷毀」的臨時 cluster。
#
# 用法：
#   bash scripts/ephemeral-pg.sh up-slice     # Build 1e：受測 dependency slice（正式路徑）
#   bash scripts/ephemeral-pg.sh load-slice
#   bash scripts/ephemeral-pg.sh verify
#   bash scripts/ephemeral-pg.sh verify --drift-control {function|schema}
#   bash scripts/ephemeral-pg.sh up
#   bash scripts/ephemeral-pg.sh diagnose-migrations   # 診斷用，預期 nonzero，不是測試 gate
#   bash scripts/ephemeral-pg.sh test
#   bash scripts/ephemeral-pg.sh test --negative-control
#   bash scripts/ephemeral-pg.sh down
#
# 安全性：
#   - listen_addresses=''：物理上無法連到任何遠端 / production 資料庫。
#   - 執行前清除所有 PG* 連線環境變數。
#   - cleanup 只刪除本腳本建立、且路徑前綴 + PG_VERSION 皆通過驗證的 exact 目錄。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="/tmp/bsr-eph"
STATE_FILE="${PREFIX}-session"
NIX_EXPR='with (import <nixpkgs> {}); postgresql_17.withPackages (p: [ p.pgvector p.pg_cron p.pg_net ])'
NIX_EXPR_SLICE='with (import <nixpkgs> {}); postgresql_17'
FIXTURES_DIR_REL="supabase/tests/fixtures"
DBNAME="bsr_ephemeral"

die() { echo "FATAL: $*" >&2; exit 1; }

# initdb/postgres 拒絕以 root 執行。root 環境下一律降權到 uid 1000 (lovable)。
EPH_UID=1000
EPH_GID=1000
asuser() {
  if [ "$(id -u)" -eq 0 ]; then
    setpriv --reuid="$EPH_UID" --regid="$EPH_GID" --clear-groups \
      env HOME=/tmp PATH="$PATH" PGOPTIONS="${PGOPTIONS:-}" "$@"
  else
    env PGOPTIONS="${PGOPTIONS:-}" "$@"
  fi
}

# 一律不繼承 production 連線資訊
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSSLMODE || true

load_session() {
  [ -f "$STATE_FILE" ] || die "no ephemeral session (run: $0 up)"
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  [ -n "${EPH_DIR:-}" ] || die "corrupt session file"
  case "$EPH_DIR" in "${PREFIX}-"*) : ;; *) die "refusing session dir outside prefix: $EPH_DIR" ;; esac
  [ -d "$EPH_DIR/data" ] || die "session dir missing: $EPH_DIR"
  PGBIN="$EPH_PGBIN"
  PGDATA="$EPH_DIR/data"
  SOCKDIR="$EPH_DIR"
  export PGDATA
}

psql_run() {
  PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$SOCKDIR" -U postgres -d "$DBNAME" -X -v ON_ERROR_STOP=1 "$@"
}

# 給 bsr-slice-verify.sh / closure-check.sh 用的 psql wrapper（SLICE_PSQL）
write_psql_wrapper() {
  local w="$SOCKDIR/psqlw"
  if [ "$(id -u)" -eq 0 ]; then
    cat > "$w" <<W
#!/usr/bin/env bash
exec setpriv --reuid=$EPH_UID --regid=$EPH_GID --clear-groups \
  env HOME=/tmp PATH="\$PATH" PGOPTIONS='-c bsr.ephemeral=1' \
  "$PGBIN/psql" -h "$SOCKDIR" -U postgres -d "$DBNAME" "\$@"
W
  else
    cat > "$w" <<W
#!/usr/bin/env bash
exec env PGOPTIONS='-c bsr.ephemeral=1' "$PGBIN/psql" -h "$SOCKDIR" -U postgres -d "$DBNAME" "\$@"
W
  fi
  chmod 755 "$w"
  echo "$w"
}

destroy_dir() {
  local dir="$1"
  case "$dir" in
    "${PREFIX}-"*"-pg17") : ;;
    *) die "refusing to delete non-matching path: $dir" ;;
  esac
  [ -f "$dir/data/PG_VERSION" ] || die "refusing to delete: $dir/data/PG_VERSION missing"
  [ "$(cat "$dir/data/PG_VERSION")" = "17" ] || die "refusing to delete: unexpected PG_VERSION"
  asuser "$PGBIN/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$dir"
  echo "destroyed $dir"
}

cmd_up() {
  [ -f "$STATE_FILE" ] && die "session already exists ($STATE_FILE); run '$0 down' first"

  echo "==> nix build postgresql_17 + pgvector + pg_cron + pg_net"
  local pgpkg
  pgpkg="$(nix build --impure --no-link --print-out-paths --expr "$NIX_EXPR")" \
    || die "nix build failed — Tier B-write stays PENDING (no partial migration fallback)"
  echo "    $pgpkg"

  local dir="${PREFIX}-$$-pg17"
  mkdir -p "$dir"
  chmod 700 "$dir"
  trap 'echo "up failed"; rm -rf "'"$dir"'"' ERR

  PGBIN="$pgpkg/bin"
  chown -R "$EPH_UID:$EPH_GID" "$dir" 2>/dev/null || true
  asuser "$PGBIN/initdb" -D "$dir/data" -U postgres --auth=trust -E UTF8 >/dev/null
  cat >> "$dir/data/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$dir'
shared_preload_libraries = 'pg_cron,pg_net'
cron.database_name = '$DBNAME'
fsync = off
full_page_writes = off
synchronous_commit = off
max_connections = 30
CONF
  asuser "$PGBIN/pg_ctl" -D "$dir/data" -l "$dir/postgres.log" -w start >/dev/null
  asuser "$PGBIN/createdb" -h "$dir" -U postgres "$DBNAME"

  cat > "$STATE_FILE" <<STATE
EPH_DIR=$dir
EPH_PGBIN=$PGBIN
EPH_OWNER_PID=$$
STATE
  trap - ERR

  SOCKDIR="$dir"
  echo "==> bootstrap"
  psql_run -f "$REPO_ROOT/supabase/tests/_bootstrap_ephemeral.sql" >/dev/null
  psql_run -c "SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS addr, current_setting('unix_socket_directories') AS sock;"
  echo "UP OK: $dir"
}

# 診斷用：repo migration history 不自足（缺 pre-history baseline），本命令預期失敗。
# 這不是 Tier B-write gate，永不輸出 PASS。
cmd_diagnose_migrations() {
  load_session
  echo "==> diagnose-migrations（診斷用，非測試 gate）"
  echo "    已知：supabase/migrations/ 不是自足歷史，從空庫全量套用預期 nonzero。"
  echo "    本命令的失敗屬獨立 DR 技術債，不影響 Build 1e Tier B-write 判定。"
  local total=0 applied=0 f
  for f in $(ls "$REPO_ROOT"/supabase/migrations/*.sql | sort); do
    total=$((total + 1))
    if ! psql_run -f "$f" > "$SOCKDIR/last_migration.log" 2>&1; then
      echo "MIGRATION FAILED (#$total): $f"
      tail -20 "$SOCKDIR/last_migration.log"
      die "migration bootstrappability FAIL at $f（已知技術債，非 Tier B-write gate）"
    fi
    applied=$((applied + 1))
    printf '\r    applied %d/%d' "$applied" "$total"
  done
  echo ""
  echo "MIGRATIONS APPLIED: ${applied}/${total}（若走到這裡代表歷史已自足，請另行審核）"
}

cmd_test() {
  load_session
  local mode="${1:-normal}"
  if [ "$mode" = "--negative-control" ]; then
    echo "==> negative control (expect NON-ZERO exit)"
    PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$SOCKDIR" -U postgres -d "$DBNAME" -X \
      -v ON_ERROR_STOP=1 -v negative_control=1 \
      -f "$REPO_ROOT/supabase/tests/bsr_recovery_write_test.sql"
    return $?
  fi

  # Case C 需要一個持有 advisory lock 771001 的背景 session
  echo "==> starting lock holder (advisory 771001)"
  asuser "$PGBIN/psql" -h "$SOCKDIR" -U postgres -d "$DBNAME" -X -q \
    -c "BEGIN; SELECT pg_advisory_xact_lock(771001); SELECT pg_sleep(20); ROLLBACK;" >/dev/null 2>&1 &
  local holder=$!
  local waited=0
  until [ "$(asuser "$PGBIN/psql" -h "$SOCKDIR" -U postgres -d "$DBNAME" -X -t -A \
              -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=771001 AND granted")" = "1" ]; do
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -ge 15 ] && { kill "$holder" 2>/dev/null || true; die "lock holder did not acquire 771001 within 15s"; }
  done
  echo "    lock held after ${waited}s"

  set +e
  PGOPTIONS='-c bsr.ephemeral=1' asuser "$PGBIN/psql" -h "$SOCKDIR" -U postgres -d "$DBNAME" -X \
    -v ON_ERROR_STOP=1 -v negative_control=0 \
    -f "$REPO_ROOT/supabase/tests/bsr_recovery_write_test.sql"
  local rc=$?
  set -e
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
  return $rc
}

cmd_down() {
  [ -f "$STATE_FILE" ] || { echo "no session"; return 0; }
  load_session
  destroy_dir "$EPH_DIR"
  rm -f "$STATE_FILE"
}

cmd_up_slice() {
  [ -f "$STATE_FILE" ] && die "session already exists ($STATE_FILE); run '$0 down' first"

  echo "==> nix build postgresql_17 (slice：不需 pgvector/pg_cron/pg_net)"
  local pgpkg
  pgpkg="$(nix build --impure --no-link --print-out-paths --expr "$NIX_EXPR_SLICE")" \
    || die "nix build failed — Tier B-write stays PENDING"
  echo "    $pgpkg"

  local dir="${PREFIX}-$$-pg17"
  mkdir -p "$dir"; chmod 700 "$dir"
  trap 'echo "up-slice failed"; rm -rf "'"$dir"'"' ERR

  PGBIN="$pgpkg/bin"
  chown -R "$EPH_UID:$EPH_GID" "$dir" 2>/dev/null || true
  asuser "$PGBIN/initdb" -D "$dir/data" -U postgres --auth=trust -E UTF8 >/dev/null
  cat >> "$dir/data/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$dir'
fsync = off
full_page_writes = off
synchronous_commit = off
max_connections = 30
CONF
  asuser "$PGBIN/pg_ctl" -D "$dir/data" -l "$dir/postgres.log" -w start >/dev/null
  asuser "$PGBIN/createdb" -h "$dir" -U postgres "$DBNAME"

  cat > "$STATE_FILE" <<STATE
EPH_DIR=$dir
EPH_PGBIN=$PGBIN
EPH_OWNER_PID=$$
EPH_MODE=slice
STATE
  trap - ERR
  SOCKDIR="$dir"
  psql_run -c "SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS addr;"
  guard_assert
  echo "UP-SLICE OK: $dir"
}

guard_assert() {
  psql_run -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
  IF current_setting('bsr.ephemeral', true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'guard: bsr.ephemeral<>1'; END IF;
  IF inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'guard: not a unix-socket-only cluster'; END IF;
  IF current_database() <> 'bsr_ephemeral' THEN RAISE EXCEPTION 'guard: unexpected database %', current_database(); END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'guard: unexpected user %', current_user; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin','supabase_auth_admin','authenticator'))
    THEN RAISE EXCEPTION 'guard: production role fingerprint detected'; END IF;
END $$;
SQL
}

cmd_load_slice() {
  load_session
  guard_assert
  local sch="$REPO_ROOT/$FIXTURES_DIR_REL/bsr_slice_schema.sql"
  local fns="$REPO_ROOT/$FIXTURES_DIR_REL/bsr_slice_functions.sql"
  [ -f "$sch" ] || die "missing fixture: $sch（先跑 gen-bsr-slice-fixture.sh）"
  [ -f "$fns" ] || die "missing fixture: $fns"
  echo "==> reset public schema"
  psql_run -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
  echo "==> load schema fixture"
  psql_run -f "$sch" >/dev/null
  echo "==> load functions fixture"
  psql_run -f "$fns" >/dev/null
  echo "LOAD-SLICE OK"
}

cmd_verify() {
  load_session
  guard_assert
  local control="${1:-}"
  local w; w="$(write_psql_wrapper)"

  if [ -z "$control" ]; then
    SLICE_PSQL="$w" bash "$REPO_ROOT/scripts/bsr-slice-verify.sh"
    return $?
  fi

  case "$control" in
    function)
      echo "==> drift control: function（期望 exit != 0）"
      psql_run -c "COMMENT ON FUNCTION public.bsr_recovery_budget(integer) IS 'drift-control';" >/dev/null
      psql_run <<'SQL' >/dev/null
CREATE OR REPLACE FUNCTION public.expected_latest_bsr_date()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  -- drift-control: 語意等價但 md5 不同
  SELECT public.expected_latest_bsr_date_orig_placeholder();
$fn$;
SQL
      set +e
      SLICE_PSQL="$w" bash "$REPO_ROOT/scripts/bsr-slice-verify.sh"
      local rc=$?
      set -e
      echo "    drift-control(function) exit=$rc （期望 != 0）"
      cmd_load_slice >/dev/null
      [ "$rc" -ne 0 ] || die "drift-control(function) 未紅燈 — harness 無效"
      echo "DRIFT-CONTROL function OK (exit=$rc, slice restored)"
      return 0
      ;;
    schema)
      echo "==> drift control: schema（6 子案，每案期望 exit != 0）"
      local cases=(
        "ALTER TABLE public.tw_bsr_sync_queue ALTER COLUMN priority TYPE bigint;|column type"
        "ALTER TABLE public.tw_chip_fact ALTER COLUMN code DROP NOT NULL;|not null"
        "ALTER TABLE public.tw_bsr_sync_queue ALTER COLUMN attempts SET DEFAULT 7;|default"
        "ALTER TABLE public.tw_market_holidays ADD CONSTRAINT drift_ck CHECK (true);|constraint"
        "CREATE UNIQUE INDEX drift_uidx ON public.data_source_refresh_logs (id);|unique index"
        "DROP TRIGGER trg_tw_bsr_sync_queue_updated ON public.tw_bsr_sync_queue;|trigger binding"
      )
      local c sql label rc allok=0
      for c in "${cases[@]}"; do
        sql="${c%%|*}"; label="${c##*|}"
        psql_run -c "$sql" >/dev/null
        set +e
        SLICE_PSQL="$w" bash "$REPO_ROOT/scripts/bsr-slice-verify.sh" >/dev/null 2>&1
        rc=$?
        set -e
        echo "    [$label] exit=$rc （期望 != 0）"
        cmd_load_slice >/dev/null
        [ "$rc" -ne 0 ] || { echo "    FAIL: [$label] 未紅燈"; allok=1; }
      done
      [ "$allok" -eq 0 ] || die "drift-control(schema) 有子案未紅燈 — harness 無效"
      echo "DRIFT-CONTROL schema OK (6/6 紅燈, slice restored)"
      return 0
      ;;
    *) die "unknown drift control: $control（function|schema）" ;;
  esac
}

case "${1:-}" in
  up)         cmd_up ;;
  up-slice)   cmd_up_slice ;;
  load-slice) cmd_load_slice ;;
  verify)     shift; if [ "${1:-}" = "--drift-control" ]; then cmd_verify "${2:-}"; else cmd_verify ""; fi ;;
  diagnose-migrations) cmd_diagnose_migrations ;;
  test)       shift; cmd_test "${1:-normal}" ;;
  down)       cmd_down ;;
  *) echo "usage: $0 {up-slice|load-slice|verify [--drift-control function|schema]|test [--negative-control]|up|diagnose-migrations|down}"; exit 2 ;;
esac
