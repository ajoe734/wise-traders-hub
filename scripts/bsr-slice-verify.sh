#!/usr/bin/env bash
# Build 1e — drift gate + preflight（受測 dependency slice）
#
# 兩種用法：
#   1) 執行：SLICE_PSQL=<psql wrapper> bash scripts/bsr-slice-verify.sh
#   2) 當 lib 被 source：BSR_SLICE_LIB=1 source scripts/bsr-slice-verify.sh
#      （generator 用它取得同一份 canonical SQL 與 expected 比對邏輯）
#
# SLICE_PSQL 是一個可執行檔／命令，接受 psql 參數並連到目標 DB。
# 本腳本只讀 catalog，不讀任何業務資料列。

set -euo pipefail

BSR_SLICE_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BSR_SLICE_EXPECTED="${BSR_SLICE_REPO_ROOT}/supabase/tests/fixtures/bsr_slice_expected.tsv"

BSR_SLICE_FUNCTIONS=(
  bsr_backlog_metrics
  bsr_get_degrade_state
  bsr_recovery_budget
  check_kill_switch
  checkup_prefetch_universe
  expected_latest_bsr_date
  recover_quota_failed_bsr_jobs
  tw_bsr_eligibility
  tw_bsr_sync_queue_touch_updated
)
BSR_SLICE_RELATIONS=(
  checkup_storage
  chips_prefetch_targets
  data_source_refresh_logs
  expert_signals
  finmind_quota_pools
  stock_names
  system_kill_switches
  trade_records
  tw_bsr_sync_config
  tw_bsr_sync_queue
  tw_chip_fact
  tw_market_holidays
)
BSR_SLICE_KEPT_TRIGGER='trg_tw_bsr_sync_queue_updated'


slice_die() { echo "FATAL: $*" >&2; exit 1; }

_slice_fn_list_sql() {
  local out="" f
  for f in "${BSR_SLICE_FUNCTIONS[@]}"; do out="${out}${out:+,}'${f}'"; done
  echo "$out"
}
_slice_rel_list_sql() {
  local out="" r
  for r in $(printf '%s\n' "${BSR_SLICE_RELATIONS[@]}" | sort -u); do out="${out}${out:+,}'${r}'"; done
  echo "$out"
}

# ---- canonical SQL：function baseline 行 -------------------------------------
slice_fn_sql() {
cat <<SQL
SELECT 'fn'||E'\t'||p.proname||E'\t'||
  coalesce(nullif(pg_get_function_identity_arguments(p.oid),''),'-')||E'\t'||
  pg_get_function_result(p.oid)||E'\t'||p.provolatile::text||E'\t'||p.prosecdef::text||E'\t'||
  coalesce(array_to_string(p.proconfig,','),'-')||E'\t'||pg_get_userbyid(p.proowner)||E'\t'||
  md5(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname IN ($(_slice_fn_list_sql))
ORDER BY p.proname;
SQL
}

# ---- canonical SQL：relation shape fingerprint 行 ----------------------------
# canonical 字串格式與 hash 演算法見 Build 1e Final Plan v3 §1b。
slice_rel_sql() {
cat <<SQL
WITH rels AS (
  SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ($(_slice_rel_list_sql))
),
cols AS (
  SELECT r.relname, string_agg(
    a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull::text||'|'||
    coalesce(trim(regexp_replace(pg_get_expr(d.adbin,d.adrelid),'\s+',' ','g')),'-')||'|'||
    coalesce(nullif(a.attidentity::text,''),'-')||'|'||coalesce(nullif(a.attgenerated::text,''),'-')
    , E'\n' ORDER BY a.attname) AS s
  FROM rels r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  GROUP BY r.relname
),
cons AS (
  SELECT r.relname, coalesce(string_agg(x.conname||'|'||x.def, E'\n' ORDER BY x.conname),'-') AS s
  FROM rels r LEFT JOIN LATERAL (
    SELECT co.conname, trim(regexp_replace(pg_get_constraintdef(co.oid),'\s+',' ','g')) AS def
    FROM pg_constraint co WHERE co.conrelid=r.oid AND (co.contype IN ('p','u','c')
      OR (co.contype='f' AND co.confrelid IN (SELECT oid FROM rels)))
  ) x ON true GROUP BY r.relname
),
idx AS (
  SELECT r.relname, coalesce(string_agg(x.iname||'|'||x.def, E'\n' ORDER BY x.iname),'-') AS s
  FROM rels r LEFT JOIN LATERAL (
    SELECT ic.relname AS iname, trim(regexp_replace(pg_get_indexdef(i.indexrelid),'\s+',' ','g')) AS def
    FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
    WHERE i.indrelid=r.oid AND i.indisunique
  ) x ON true GROUP BY r.relname
),
trg AS (
  SELECT r.relname, coalesce(string_agg(x.tgname||'|'||x.def, E'\n' ORDER BY x.tgname),'-') AS s
  FROM rels r LEFT JOIN LATERAL (
    SELECT t.tgname, trim(regexp_replace(pg_get_triggerdef(t.oid),'\s+',' ','g')) AS def
    FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal
      AND t.tgname = '${BSR_SLICE_KEPT_TRIGGER}'
  ) x ON true GROUP BY r.relname
)
SELECT 'rel'||E'\t'||c.relname||E'\t'||
  encode(sha256(convert_to(
    'RELATION '||c.relname||E'\n#COLUMNS\n'||c.s||E'\n#CONSTRAINTS\n'||k.s||E'\n#UNIQUE_INDEXES\n'||i.s||E'\n#TRIGGERS\n'||t.s
  ,'UTF8')),'hex')
FROM cols c JOIN cons k USING (relname) JOIN idx i USING (relname) JOIN trg t USING (relname)
ORDER BY c.relname;
SQL
}

slice_psql() {
  [ -n "${SLICE_PSQL:-}" ] || slice_die "SLICE_PSQL not set"
  "$SLICE_PSQL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"
}

slice_actual_lines() {
  { slice_fn_sql; slice_rel_sql; } > /tmp/.bsr-slice-actual.sql
  slice_psql -f /tmp/.bsr-slice-actual.sql | sed '/^$/d'
}

slice_expected_lines() {
  grep -v '^#' "$BSR_SLICE_EXPECTED" | sed '/^$/d'
}

# 逐物件、逐欄位 diff。回傳 0 = 完全相符。
slice_compare_expected() {
  local label="$1" actual exp rc=0
  actual="$(slice_actual_lines)"
  exp="$(slice_expected_lines)"

  local fn_cols=(kind name identity_args returns volatility secdef proconfig owner md5)
  local line name kind a_line
  while IFS= read -r line; do
    kind="$(cut -f1 <<<"$line")"; name="$(cut -f2 <<<"$line")"
    a_line="$(awk -F'\t' -v k="$kind" -v n="$name" '$1==k && $2==n' <<<"$actual" || true)"
    if [ -z "$a_line" ]; then
      echo "DRIFT [$label] MISSING $kind $name (expected present, actual absent)"; rc=1; continue
    fi
    if [ "$a_line" != "$line" ]; then
      rc=1
      if [ "$kind" = "fn" ]; then
        local i
        for i in $(seq 1 9); do
          local e a; e="$(cut -f$i <<<"$line")"; a="$(cut -f$i <<<"$a_line")"
          [ "$e" = "$a" ] || echo "DRIFT [$label] fn $name field=${fn_cols[$((i-1))]} expected='$e' actual='$a'"
        done
      else
        echo "DRIFT [$label] rel $name field=sha256 expected='$(cut -f3 <<<"$line")' actual='$(cut -f3 <<<"$a_line")'"
      fi
    fi
  done <<<"$exp"

  while IFS= read -r line; do
    kind="$(cut -f1 <<<"$line")"; name="$(cut -f2 <<<"$line")"
    if ! awk -F'\t' -v k="$kind" -v n="$name" '$1==k && $2==n' <<<"$exp" | grep -q .; then
      echo "DRIFT [$label] UNEXPECTED $kind $name (actual present, not in pinned baseline)"; rc=1
    fi
  done <<<"$actual"

  return $rc
}

# 被 source 當 lib 時到此為止
if [ "${BSR_SLICE_LIB:-0}" = "1" ]; then
  return 0 2>/dev/null || true
fi

# ---------------------------- main（slice 端 verify）--------------------------
echo "==> [1/4] closure check (slice)"
SLICE_PSQL="$SLICE_PSQL" bash "${BSR_SLICE_REPO_ROOT}/scripts/bsr-slice-closure-check.sh" --scope slice \
  || slice_die "closure check failed"

echo "==> [2/4] drift gate vs pinned baseline"
if slice_compare_expected slice; then
  echo "    OK: 9 functions + 12 relations 全部符合 pinned baseline"
else
  slice_die "drift detected — behavior tests NOT started"
fi

echo "==> [3/4] per-function compile gate (check_function_bodies=on，抵銷 fixture load 時的 off)"
slice_psql <<SQL || slice_die "compile gate failed"
\set ON_ERROR_STOP on
SET check_function_bodies = on;
BEGIN;
DO \$outer\$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
           WHERE ns.nspname='public' AND p.proname IN ($(_slice_fn_list_sql)) ORDER BY p.proname
  LOOP
    EXECUTE pg_get_functiondef(r.oid);   -- 重新編譯：unresolved dependency 會在此炸掉
    n := n + 1;
  END LOOP;
  IF n <> 9 THEN RAISE EXCEPTION 'compile gate: expected 9 functions, got %', n; END IF;
  RAISE NOTICE 'compile gate: % functions recompiled with check_function_bodies=on', n;
END
\$outer\$;
ROLLBACK;
SQL

echo "==> [4/4] preflight (9 functions call/read-only + trigger fn + zero-budget smoke in ROLLBACK)"
slice_psql <<'SQL' || slice_die "preflight failed"

\set ON_ERROR_STOP on
DO $$
DECLARE n int;
BEGIN
  -- pristine 斷言：三張寫入路徑上的表必須為空
  SELECT count(*) INTO n FROM public.tw_bsr_sync_queue;        IF n<>0 THEN RAISE EXCEPTION 'not pristine: queue=%', n; END IF;
  SELECT count(*) INTO n FROM public.tw_chip_fact;             IF n<>0 THEN RAISE EXCEPTION 'not pristine: fact=%', n; END IF;
  SELECT count(*) INTO n FROM public.data_source_refresh_logs; IF n<>0 THEN RAISE EXCEPTION 'not pristine: audit=%', n; END IF;
END $$;

SELECT public.expected_latest_bsr_date();
SELECT public.check_kill_switch('chips_all');
SELECT count(*) FROM public.bsr_get_degrade_state('finmind');
SELECT count(*) FROM public.checkup_prefetch_universe();
SELECT public.bsr_backlog_metrics();
SELECT public.bsr_recovery_budget(1);

-- 新增 closure 物件：tw_bsr_eligibility 的語意（唯讀，只讀 stock_names）
DO $$
BEGIN
  IF (public.tw_bsr_eligibility('2330')->>'eligible') <> 'true'
    THEN RAISE EXCEPTION 'eligibility: 2330 should be eligible'; END IF;
  IF (public.tw_bsr_eligibility('0050')->>'ineligible_reason') <> 'unsupported_asset_type'
    THEN RAISE EXCEPTION 'eligibility: 0050 should be unsupported_asset_type'; END IF;
  IF (public.tw_bsr_eligibility('')->>'ineligible_reason') <> 'invalid_stock_id'
    THEN RAISE EXCEPTION 'eligibility: empty should be invalid_stock_id'; END IF;
END $$;


BEGIN;
-- trigger function tw_bsr_sync_queue_touch_updated 實際綁定執行（交易內，稍後 ROLLBACK）
INSERT INTO public.tw_bsr_sync_queue (stock_id, status) VALUES ('__preflight__', 'pending');
UPDATE public.tw_bsr_sync_queue SET status='pending' WHERE stock_id='__preflight__';
DO $$
DECLARE u timestamptz;
BEGIN
  SELECT updated_at INTO u FROM public.tw_bsr_sync_queue WHERE stock_id='__preflight__';
  IF u IS NULL THEN RAISE EXCEPTION 'trigger fn did not set updated_at'; END IF;
END $$;
SELECT public.recover_quota_failed_bsr_jobs(0);
ROLLBACK;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tw_bsr_sync_queue;        IF n<>0 THEN RAISE EXCEPTION 'smoke leaked into queue: %', n; END IF;
  SELECT count(*) INTO n FROM public.tw_chip_fact;             IF n<>0 THEN RAISE EXCEPTION 'smoke leaked into fact: %', n; END IF;
  SELECT count(*) INTO n FROM public.data_source_refresh_logs; IF n<>0 THEN RAISE EXCEPTION 'smoke leaked into audit: %', n; END IF;
END $$;
SQL

echo "VERIFY OK"
