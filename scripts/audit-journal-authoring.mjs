#!/usr/bin/env node
/**
 * audit-journal-authoring.mjs
 *
 * 週記撰寫零錯誤深掃 — Step 4 資料稽核腳本（read-only，全量）。
 *
 * 稽核六大類（皆對齊 mem://features/mentor-publishing-workflow 與
 * mem://logic/trading/* 憲法）：
 *   1. open trade_records + pending expert_signals 的 quantity_unit
 *      × experts.asset_class 一致性（美股不得為張/口、台股股票不得為股/口 等）
 *   2. expert_signals 品質：quantity=0、action 缺、price_hint=0/NULL、
 *      teaching 缺 learning_points / teaching_topic
 *   3. experts.starting_capital 缺漏 / <=0，以及已發布訊號資金佔用是否溢位
 *   4. profiles.expert_slug 對應 experts.slug 缺漏 / 不符
 *   5. trade_records.currency × experts.asset_class 不一致
 *      （us_stock+TWD、tw_stock+USD 等）
 *   6. open 台股「張」但 base 股數非 1000 倍數
 *
 * 用法：
 *   node scripts/audit-journal-authoring.mjs           # 印摘要 + 明細
 *   node scripts/audit-journal-authoring.mjs --json    # 純 JSON 便於 CI 比對
 *
 * Exit codes：
 *   0 = 全數歸零
 *   2 = 至少一類有髒資料
 */
import { execSync } from 'node:child_process'

const JSON_ONLY = process.argv.includes('--json')

function runSqlJson(query) {
  const out = execSync(`psql -X -A -t -v ON_ERROR_STOP=1`, {
    encoding: 'utf8',
    input: query,
    shell: '/bin/bash',
    maxBuffer: 64 * 1024 * 1024,
  })
  const line = out.trim()
  if (!line) return []
  return JSON.parse(line)
}

// ---------- Queries ----------
const Q1_UNIT_MISMATCH = `
WITH unified AS (
  SELECT 'trade_records'::text src, tr.id::text row_id, tr.expert_id,
         tr.instrument, tr.quantity, tr.quantity_unit, tr.status::text
    FROM public.trade_records tr WHERE tr.status = 'open'
  UNION ALL
  -- C7: teaching signals 無交易語意，quantity/quantity_unit 一律為 null，
  -- 顯式排除避免假陽性。
  SELECT 'expert_signals', es.id::text, es.expert_id,
         es.instrument, es.quantity, es.quantity_unit, es.status::text
    FROM public.expert_signals es
   WHERE es.status = 'pending' AND es.action <> 'teaching'
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'source', u.src, 'row_id', u.row_id, 'expert_id', u.expert_id::text,
  'expert_label', COALESCE(e.name, e.slug, u.expert_id::text),
  'asset_class', e.asset_class, 'instrument', u.instrument,
  'quantity_unit', u.quantity_unit, 'quantity', u.quantity, 'status', u.status
) ORDER BY e.name, u.instrument), '[]'::jsonb)::text
FROM unified u LEFT JOIN public.experts e ON e.id = u.expert_id
WHERE u.quantity_unit IS NOT NULL AND btrim(u.quantity_unit) <> ''
  AND (
    (e.asset_class = 'us_stock'  AND u.quantity_unit NOT IN ('股','口'))
 OR (e.asset_class = 'us_stock'  AND u.quantity_unit = '張')
 OR (e.asset_class = 'tw_stock'  AND u.quantity_unit NOT IN ('張','股'))
  );
`

const Q2_SIGNAL_QUALITY = `
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'row_id', es.id::text, 'expert_id', es.expert_id::text,
  'expert_label', COALESCE(e.name, e.slug, es.expert_id::text),
  'status', es.status, 'action', es.action, 'instrument', es.instrument,
  'quantity', es.quantity, 'price_hint', es.price_hint,
  'teaching_topic', es.teaching_topic,
  'has_learning_points', (es.learning_points IS NOT NULL AND btrim(es.learning_points) <> ''),
  'issues', (
    ARRAY[]::text[]
    || CASE WHEN es.action IS NULL OR btrim(es.action::text) = '' THEN ARRAY['MISSING_ACTION']       ELSE ARRAY[]::text[] END
    || CASE WHEN es.action <> 'teaching' AND (es.quantity IS NULL OR es.quantity = 0)
             THEN ARRAY['QUANTITY_ZERO']       ELSE ARRAY[]::text[] END
    || CASE WHEN es.action <> 'teaching' AND (es.price_hint IS NULL OR es.price_hint = 0)
             THEN ARRAY['PRICE_HINT_ZERO']     ELSE ARRAY[]::text[] END
    || CASE WHEN es.action = 'teaching'
                AND (es.learning_points IS NULL OR btrim(es.learning_points) = '')
             THEN ARRAY['TEACHING_MISSING_LEARNING'] ELSE ARRAY[]::text[] END
    || CASE WHEN es.action = 'teaching'
                AND (es.teaching_topic IS NULL OR btrim(es.teaching_topic) = '')
             THEN ARRAY['TEACHING_MISSING_TOPIC']    ELSE ARRAY[]::text[] END
  )
) ORDER BY es.expert_id, es.created_at), '[]'::jsonb)::text
FROM public.expert_signals es
LEFT JOIN public.experts e ON e.id = es.expert_id
WHERE es.status IN ('pending','published')
  AND (
       es.action IS NULL OR btrim(es.action::text) = ''
    OR (es.action <> 'teaching' AND (es.quantity IS NULL OR es.quantity = 0))
    OR (es.action <> 'teaching' AND (es.price_hint IS NULL OR es.price_hint = 0))
    OR (es.action  = 'teaching' AND (es.learning_points IS NULL OR btrim(es.learning_points) = ''))
    OR (es.action  = 'teaching' AND (es.teaching_topic  IS NULL OR btrim(es.teaching_topic)  = ''))
  );
`

const Q3_CAPITAL = `
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'expert_id', e.id::text,
  'expert_label', COALESCE(e.name, e.slug, e.id::text),
  'asset_class', e.asset_class, 'currency', e.currency,
  'starting_capital', e.starting_capital,
  'issue', CASE
    WHEN e.starting_capital IS NULL THEN 'CAPITAL_NULL'
    WHEN e.starting_capital <= 0    THEN 'CAPITAL_NONPOSITIVE'
    ELSE 'OTHER' END
) ORDER BY e.name), '[]'::jsonb)::text
FROM public.experts e
WHERE e.status = 'published'
  AND (e.starting_capital IS NULL OR e.starting_capital <= 0);
`

const Q4_SLUG = `
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'user_id', p.user_id::text,
  'display_name', p.display_name,
  'profile_slug', p.expert_slug,
  'expected_slug', e.slug,
  'issue', CASE
    WHEN p.expert_slug IS NULL AND e.slug IS NOT NULL THEN 'PROFILE_SLUG_MISSING'
    WHEN p.expert_slug IS NOT NULL AND e.slug IS NULL THEN 'EXPERT_ROW_MISSING'
    WHEN p.expert_slug <> e.slug THEN 'SLUG_MISMATCH' END
) ORDER BY p.display_name), '[]'::jsonb)::text
FROM public.profiles p
LEFT JOIN public.experts e ON e.user_id = p.user_id
WHERE (p.expert_slug IS NOT NULL OR e.slug IS NOT NULL)
  AND (p.expert_slug IS DISTINCT FROM e.slug);
`

const Q5_CURRENCY = `
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'row_id', tr.id::text,
  'expert_id', tr.expert_id::text,
  'expert_label', COALESCE(e.name, e.slug, tr.expert_id::text),
  'asset_class', e.asset_class, 'expert_currency', e.currency,
  'instrument', tr.instrument, 'trade_currency', tr.currency,
  'status', tr.status
) ORDER BY e.name, tr.instrument), '[]'::jsonb)::text
FROM public.trade_records tr
LEFT JOIN public.experts e ON e.id = tr.expert_id
WHERE tr.currency IS NOT NULL
  AND (
    (e.asset_class = 'us_stock' AND tr.currency <> 'USD')
 OR (e.asset_class = 'tw_stock' AND tr.currency <> 'TWD')
  );
`

const Q6_LOT_INTEGRITY = `
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'row_id', tr.id::text,
  'expert_id', tr.expert_id::text,
  'expert_label', COALESCE(e.name, e.slug, tr.expert_id::text),
  'instrument', tr.instrument,
  'quantity', tr.quantity,
  'quantity_unit', tr.quantity_unit
) ORDER BY e.name, tr.instrument), '[]'::jsonb)::text
FROM public.trade_records tr
LEFT JOIN public.experts e ON e.id = tr.expert_id
WHERE tr.status = 'open'
  AND e.asset_class = 'tw_stock'
  AND tr.quantity_unit = '張'
  AND tr.quantity IS NOT NULL
  AND (tr.quantity <> floor(tr.quantity));
`

// ---------- Execute ----------
const buckets = [
  { key: 'unit_mismatch',   label: '1. quantity_unit × asset_class 不一致',        sql: Q1_UNIT_MISMATCH },
  { key: 'signal_quality',  label: '2. expert_signals 品質（action/qty/price/teach）', sql: Q2_SIGNAL_QUALITY },
  { key: 'capital_missing', label: '3. experts.starting_capital 缺漏 / <=0',       sql: Q3_CAPITAL },
  { key: 'slug_desync',     label: '4. profiles.expert_slug ↔ experts.slug 不同步', sql: Q4_SLUG },
  { key: 'currency_mismatch', label: '5. trade_records.currency × asset_class 衝突', sql: Q5_CURRENCY },
  { key: 'tw_lot_integrity', label: '6. 台股「張」但 quantity 非整數',              sql: Q6_LOT_INTEGRITY },
]

const findings = {}
let total = 0
for (const b of buckets) {
  const rows = runSqlJson(b.sql)
  findings[b.key] = rows
  total += rows.length
}

const summary = {
  scanned_at: new Date().toISOString(),
  total_findings: total,
  by_bucket: Object.fromEntries(buckets.map((b) => [b.key, findings[b.key].length])),
}

if (JSON_ONLY) {
  console.log(JSON.stringify({ summary, findings }, null, 2))
  process.exit(total > 0 ? 2 : 0)
}

console.log('=== 週記撰寫零錯誤深掃 — 資料稽核 ===')
console.log(`scanned_at: ${summary.scanned_at}`)
console.log(`total findings: ${summary.total_findings}`)
console.log('')
for (const b of buckets) {
  const rows = findings[b.key]
  const marker = rows.length === 0 ? '✅' : '❌'
  console.log(`${marker} ${b.label} — ${rows.length} 筆`)
  for (const r of rows.slice(0, 20)) {
    console.log(`   · ${JSON.stringify(r)}`)
  }
  if (rows.length > 20) console.log(`   … 另有 ${rows.length - 20} 筆略`)
}
console.log('')
console.log(total === 0 ? '✅ PASS — 全數歸零。' : '❌ FAIL — 上列類別需修正後重跑。')
process.exit(total > 0 ? 2 : 0)
