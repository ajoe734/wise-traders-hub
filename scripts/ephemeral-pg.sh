#!/usr/bin/env bash
# Build 1d — ephemeral PostgreSQL harness（Tier B-write 專用）
#
# 為什麼不是 `supabase db start`：本環境沒有 Docker（/var/run/docker.sock 不存在），
# 也沒有 Supabase CLI。改用本機 PostgreSQL 17 二進位在 /tmp 起一個
# 「只開 unix socket、用完即銷毀」的臨時 cluster。
#
# 用法：
#   bash scripts/ephemeral-pg.sh up
#   bash scripts/ephemeral-pg.sh migrate
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

cmd_migrate() {
  load_session
  local total=0 applied=0 f
  for f in $(ls "$REPO_ROOT"/supabase/migrations/*.sql | sort); do
    total=$((total + 1))
    if ! psql_run -f "$f" > "$SOCKDIR/last_migration.log" 2>&1; then
      echo "MIGRATION FAILED (#$total): $f"
      tail -20 "$SOCKDIR/last_migration.log"
      die "full-apply gate failed at $f — Build 1d is FAIL/PENDING (no skipping allowed)"
    fi
    applied=$((applied + 1))
    printf '\r    applied %d/%d' "$applied" "$total"
  done
  echo ""
  echo "MIGRATE OK: ${applied}/${total} applied, 0 skipped"
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

case "${1:-}" in
  up)      cmd_up ;;
  migrate) cmd_migrate ;;
  test)    shift; cmd_test "${1:-normal}" ;;
  down)    cmd_down ;;
  *) echo "usage: $0 {up|migrate|test [--negative-control]|down}"; exit 2 ;;
esac
