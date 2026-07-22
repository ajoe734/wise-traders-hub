#!/usr/bin/env node
/**
 * audit-open-unit-conflicts.mjs
 *
 * 抽查同 (expert_id, symbol) 在「未平倉範圍」（trade_records.status='open'
 * + expert_signals.status='pending'）內是否仍有 quantity_unit 混用衝突。
 *
 * 對齊 public.enforce_unit_consistency 的比對範圍——如果這裡有輸出，就代表
 * DB 裡已經存在 trigger 不再擋、但 UI/歷史遺留下來的髒資料。
 *
 * 用法：
 *   node scripts/audit-open-unit-conflicts.mjs           # 印摘要 + 明細
 *   node scripts/audit-open-unit-conflicts.mjs --json    # 純 JSON 便於 CI 比對
 *
 * 需求：PGHOST/PGUSER/PGPASSWORD/PGDATABASE 已設定（sandbox / CI 皆已注入）。
 */
import { execSync } from 'node:child_process'

const JSON_ONLY = process.argv.includes('--json')

// symbol 抽取規則對齊 enforce_unit_consistency：split_part(btrim(instrument), ' ', 1)
const SQL = `
WITH unified AS (
  SELECT
    'trade_records'::text AS source,
    id::text              AS row_id,
    expert_id,
    split_part(btrim(instrument), ' ', 1) AS symbol,
    instrument,
    quantity_unit,
    quantity,
    status::text          AS status,
    created_at
  FROM public.trade_records
  WHERE status = 'open'
    AND quantity_unit IS NOT NULL
    AND btrim(quantity_unit) <> ''
  UNION ALL
  SELECT
    'expert_signals'::text,
    id::text,
    expert_id,
    split_part(btrim(instrument), ' ', 1),
    instrument,
    quantity_unit,
    quantity,
    status::text,
    created_at
  FROM public.expert_signals
  WHERE status = 'pending'
    AND quantity_unit IS NOT NULL
    AND btrim(quantity_unit) <> ''
),
grouped AS (
  SELECT
    expert_id,
    symbol,
    COUNT(*)                                       AS n_rows,
    COUNT(DISTINCT quantity_unit)                  AS n_units,
    array_agg(DISTINCT quantity_unit ORDER BY quantity_unit) AS units,
    jsonb_agg(
      jsonb_build_object(
        'source', source,
        'row_id', row_id,
        'instrument', instrument,
        'quantity_unit', quantity_unit,
        'quantity', quantity,
        'status', status,
        'created_at', created_at
      )
      ORDER BY created_at
    ) AS rows
  FROM unified
  GROUP BY expert_id, symbol
)
SELECT
  g.expert_id::text,
  COALESCE(e.name, e.slug, g.expert_id::text) AS expert_label,
  e.asset_class,
  g.symbol,
  g.n_rows,
  g.units,
  g.rows
FROM grouped g
LEFT JOIN public.experts e ON e.id = g.expert_id
WHERE g.n_units > 1
ORDER BY expert_label, g.symbol;
`

function runSql(query) {
  const out = execSync(`psql -X -A -t -F $'\\t' -v ON_ERROR_STOP=1`, {
    encoding: 'utf8',
    input: query,
    shell: '/bin/bash',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function parsePgArray(s) {
  const m = String(s || '').match(/^\{(.*)\}$/)
  if (!m) return []
  if (!m[1]) return []
  return m[1].split(',').map((x) => x.replace(/^"|"$/g, ''))
}

const lines = runSql(SQL)

const conflicts = lines.map((line) => {
  const [expert_id, expert_label, asset_class, symbol, n_rows, unitsRaw, rowsJson] =
    line.split('\t')
  return {
    expert_id,
    expert_label,
    asset_class: asset_class || null,
    symbol,
    n_rows: Number(n_rows),
    units: parsePgArray(unitsRaw),
    rows: JSON.parse(rowsJson),
  }
})

const summary = {
  scanned_scope: "trade_records.status='open' UNION expert_signals.status='pending'",
  conflict_groups: conflicts.length,
  total_conflicting_rows: conflicts.reduce((s, c) => s + c.n_rows, 0),
  by_asset_class: conflicts.reduce((m, c) => {
    const k = c.asset_class || '(null)'
    m[k] = (m[k] || 0) + 1
    return m
  }, {}),
  by_expert: conflicts.reduce((m, c) => {
    m[c.expert_label] = (m[c.expert_label] || 0) + 1
    return m
  }, {}),
}

if (JSON_ONLY) {
  console.log(JSON.stringify({ summary, conflicts }, null, 2))
  process.exit(conflicts.length > 0 ? 2 : 0)
}

console.log('=== Open/Pending Unit Conflict Audit ===')
console.log(`scope: ${summary.scanned_scope}`)
console.log(`conflict groups (expert × symbol): ${summary.conflict_groups}`)
console.log(`total conflicting rows: ${summary.total_conflicting_rows}`)
if (summary.conflict_groups > 0) {
  console.log('by asset_class:', summary.by_asset_class)
  console.log('by expert:', summary.by_expert)
  console.log('')
  for (const c of conflicts) {
    console.log(
      `─ ${c.expert_label} [${c.asset_class ?? 'unknown'}] ${c.symbol}  units=${c.units.join('/')}  rows=${c.n_rows}`,
    )
    for (const r of c.rows) {
      console.log(
        `    · ${r.source} ${r.row_id}  ${r.instrument}  qty=${r.quantity} ${r.quantity_unit}  status=${r.status}  ${r.created_at}`,
      )
    }
  }
  console.log('')
  console.log('❌ FAIL — 未平倉範圍內仍有單位混用；請到週記編輯用「改單位…」或先平倉後重建。')
} else {
  console.log('✅ PASS — 未平倉範圍內無單位混用衝突。')
}

process.exit(conflicts.length > 0 ? 2 : 0)
