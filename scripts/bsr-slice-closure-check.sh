#!/usr/bin/env bash
# Build 1e — dependency closure 完整性檢查
#
#   SLICE_PSQL=<psql wrapper> bash scripts/bsr-slice-closure-check.sh --scope {prod|slice}
#
# 做三件事（任一失敗即 exit != 0）：
#   1) 從三個核心函式出發，遞迴走 pg_depend 取得被引用物件
#   2) 解析 function source，把 public.<ident> 與 unqualified 物件逐一以
#      to_regclass / to_regprocedure 解析
#   3) 對照 pinned baseline 的物件清單（9 functions + 12 relations），
#      多、少、無法解析、未預期的 trigger binding 一律 hard fail
#
# 只讀 catalog 與 function 定義，不讀任何業務資料列。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BSR_SLICE_LIB=1 source "$ROOT/scripts/bsr-slice-verify.sh"

SCOPE="slice"
while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
case "$SCOPE" in prod|slice) : ;; *) echo "FATAL: --scope must be prod|slice" >&2; exit 2 ;; esac

q() { "$SLICE_PSQL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }

CORE=(bsr_backlog_metrics bsr_recovery_budget recover_quota_failed_bsr_jobs)
core_in="$(printf "'%s'," "${CORE[@]}" | sed 's/,$//')"

TMP="$(mktemp -d /tmp/bsr-closure-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
# 實際跑 psql 的可能是降權後的 uid 1000（見 ephemeral-pg.sh asuser）。
# 最小權限：目錄 0755 可 traverse，輸入檔 0644 唯讀可讀。禁止 chmod -R 777。
chmod 755 "$TMP"
sqlfile() { # sqlfile <path>：寫檔後設成 0644
  chmod 644 "$1"
}

# ---- 1) pg_depend 遞迴 --------------------------------------------------------
cat > "$TMP/depend.sql" <<SQL
WITH RECURSIVE seed AS (
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ($core_in)
),
walk(objid, classid) AS (
  SELECT oid, 'pg_proc'::regclass::oid FROM seed
  UNION
  SELECT d.refobjid, d.refclassid
  FROM pg_depend d JOIN walk w ON d.objid = w.objid AND d.classid = w.classid
  WHERE d.refclassid IN ('pg_class'::regclass::oid, 'pg_proc'::regclass::oid, 'pg_type'::regclass::oid)
)
SELECT DISTINCT CASE
    WHEN classid = 'pg_class'::regclass::oid THEN 'rel:'||c.relname
    WHEN classid = 'pg_proc'::regclass::oid  THEN 'fn:'||p.proname
  END
FROM walk w
LEFT JOIN pg_class c ON w.classid='pg_class'::regclass::oid AND c.oid=w.objid
  AND c.relkind IN ('r','v','m') AND c.relnamespace='public'::regnamespace
LEFT JOIN pg_proc p ON w.classid='pg_proc'::regclass::oid AND p.oid=w.objid
  AND p.pronamespace='public'::regnamespace
WHERE coalesce(c.relname, p.proname) IS NOT NULL
ORDER BY 1;
SQL
sqlfile "$TMP/depend.sql"
q -f "$TMP/depend.sql" | sed '/^$/d' | sort -u > "$TMP/depend.txt"

# ---- 2) call graph 交叉檢查 ---------------------------------------------------
cat > "$TMP/src.sql" <<SQL
SELECT p.proname||E'\t'||replace(replace(p.prosrc, E'\n', ' '), E'\t', ' ')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ($(printf "'%s'," "${BSR_SLICE_FUNCTIONS[@]}" | sed 's/,$//'))
ORDER BY p.proname;
SQL
sqlfile "$TMP/src.sql"
q -f "$TMP/src.sql" | sed '/^$/d' > "$TMP/src.tsv"

fail=0

# 2a) 動態 SQL 一律 hard fail（無法靜態解析）
while IFS=$'\t' read -r fname body; do
  if grep -qiE '(^|[^[:alnum:]_])(execute[[:space:]]+(immediate[[:space:]]+)?(format|quote_ident|'"'"'))' <<<"$body"; then
    echo "CLOSURE FAIL [$SCOPE]: dynamic SQL detected in $fname (statically unresolvable)"
    fail=1
  fi
done < "$TMP/src.tsv"

# 2b) 解析 body 內引用的物件
#     - schema-qualified: public.<ident>
#     - relation 位置: FROM / JOIN / INSERT INTO / UPDATE / DELETE FROM 之後的 identifier
#     PL/pgSQL 區域變數（DECLARE 區、SELECT ... INTO var）與 CTE 名稱先行排除，
#     避免把變數名誤判成外部物件。
: > "$TMP/refs.txt"
: > "$TMP/locals.txt"
while IFS=$'\t' read -r fname body; do
  grep -oiE 'public\.[a-z_][a-z0-9_]*' <<<"$body" | sed 's/^[Pp][Uu][Bb][Ll][Ii][Cc]\.//' | tr 'A-Z' 'a-z' >> "$TMP/refs.txt" || true
  grep -oiE '(from|join|insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+[a-z_][a-z0-9_]*' <<<"$body" \
    | awk '{print tolower($NF)}' >> "$TMP/refs.txt" || true
  # 區域變數：DECLARE 區宣告、SELECT ... INTO var、FOR var IN
  sed -E 's/^[[:space:]]*DECLARE//I' <<<"$body" | grep -oiE '[a-z_][a-z0-9_]*[[:space:]]+(record|text|int|integer|bigint|boolean|jsonb|json|numeric|date|timestamptz|uuid|refcursor)\b' \
    | awk '{print tolower($1)}' >> "$TMP/locals.txt" || true
  grep -oiE 'into[[:space:]]+(strict[[:space:]]+)?[a-z_][a-z0-9_]*' <<<"$body" | awk '{print tolower($NF)}' >> "$TMP/locals.txt" || true
  grep -oiE 'for[[:space:]]+[a-z_][a-z0-9_]*[[:space:]]+in' <<<"$body" | awk '{print tolower($2)}' >> "$TMP/locals.txt" || true
  # CTE 名稱
  grep -oiE '(with|,)[[:space:]]+[a-z_][a-z0-9_]*[[:space:]]+as[[:space:]]*\(' <<<"$body" | awk '{print tolower($2)}' >> "$TMP/locals.txt" || true
done < "$TMP/src.tsv"
# SQL 關鍵字 / 修飾字（出現在 relation 位置但不是物件）
printf '%s\n' public lateral only skip locked nowait unnest values distinct all \
  generate_series jsonb_to_recordset json_to_recordset jsonb_array_elements \
  jsonb_array_elements_text regexp_split_to_table string_to_table >> "$TMP/locals.txt"
# 表別名：FROM/JOIN <rel> <alias>
while IFS=$'\t' read -r _f body; do
  grep -oiE '(from|join)[[:space:]]+[a-z_][a-z0-9_.]*[[:space:]]+[a-z_][a-z0-9_]*' <<<"$body" \
    | awk '{print tolower($NF)}' >> "$TMP/locals.txt" || true
  # 欄位／子查詢別名：AS <alias>
  grep -oiE '[[:space:]]as[[:space:]]+[a-z_][a-z0-9_]*' <<<"$body" | awk '{print tolower($NF)}' >> "$TMP/locals.txt" || true
done < "$TMP/src.tsv"
sort -u "$TMP/refs.txt" -o "$TMP/refs.txt"
sort -u "$TMP/locals.txt" -o "$TMP/locals.txt"

: > "$TMP/resolved.txt"
while read -r ident; do
  [ -n "$ident" ] || continue
  kind="$(q -c "SELECT CASE
      WHEN to_regclass('public.$ident') IS NOT NULL THEN 'rel'
      WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='$ident') THEN 'fn'
      WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='pg_catalog' AND p.proname='$ident') THEN 'builtin'
      ELSE 'unresolved' END")"
  case "$kind" in
    rel) echo "rel:$ident" >> "$TMP/resolved.txt" ;;
    fn)  echo "fn:$ident"  >> "$TMP/resolved.txt" ;;
    builtin) : ;;
    *)
      if grep -qx "$ident" "$TMP/locals.txt"; then
        : # PL/pgSQL 區域變數 / CTE 名稱
      else
        echo "CLOSURE FAIL [$SCOPE]: unresolved / unqualified external object: $ident"
        fail=1
      fi
    ;;
  esac
done < "$TMP/refs.txt"
sort -u "$TMP/resolved.txt" -o "$TMP/resolved.txt"

# ---- 3) 對照 pinned baseline --------------------------------------------------
{
  printf 'fn:%s\n' "${BSR_SLICE_FUNCTIONS[@]}"
  printf 'rel:%s\n' "${BSR_SLICE_RELATIONS[@]}"
} | sort -u > "$TMP/baseline.txt"

cat "$TMP/depend.txt" "$TMP/resolved.txt" | sort -u > "$TMP/closure.txt"

missing="$(comm -23 "$TMP/closure.txt" "$TMP/baseline.txt" || true)"
if [ -n "$missing" ]; then
  echo "CLOSURE FAIL [$SCOPE]: closure 物件不在 pinned baseline 內："
  echo "$missing" | sed 's/^/    /'
  fail=1
fi

for fn in "${BSR_SLICE_FUNCTIONS[@]}"; do
  grep -qx "fn:$fn" "$TMP/closure.txt" || { echo "CLOSURE WARN [$SCOPE]: baseline function 未被 closure 引用: $fn"; }
done

# 3b) trigger binding 必須與 baseline 完全一致
tg_actual="$(q -c "SELECT coalesce(string_agg(c.relname||'.'||t.tgname, ',' ORDER BY c.relname, t.tgname),'-')
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname='public'
    AND c.relname IN ($(printf "'%s'," $(printf '%s\n' "${BSR_SLICE_RELATIONS[@]}" | sort -u) | sed 's/,$//'))")"
if [ "$SCOPE" = "slice" ]; then
  expected_tg="tw_bsr_sync_queue.${BSR_SLICE_KEPT_TRIGGER}"
  if [ "$tg_actual" != "$expected_tg" ]; then
    echo "CLOSURE FAIL [slice]: trigger binding 不符 baseline"
    echo "    expected='$expected_tg'"
    echo "    actual  ='$tg_actual'"
    fail=1
  fi
else
  grep -q "tw_bsr_sync_queue.${BSR_SLICE_KEPT_TRIGGER}" <<<"$tg_actual" || {
    echo "CLOSURE FAIL [prod]: production 缺少保留的 trigger binding ${BSR_SLICE_KEPT_TRIGGER}"; fail=1; }
fi

if [ "$fail" -ne 0 ]; then
  echo "CLOSURE CHECK FAILED [$SCOPE]"
  exit 1
fi
echo "CLOSURE CHECK OK [$SCOPE]  objects=$(wc -l < "$TMP/closure.txt")"
