#!/usr/bin/env node
/**
 * refresh-warrant-basic.mjs
 *
 * 從 TWSE openapi `/v1/opendata/t187ap37_L` 拉上市權證基本資料，upsert 進
 * `public.warrant_expiry`。以 GitHub Actions runner 執行，繞開 Supabase edge
 * function 出口 IP 被 TWSE 節流導致回應被截斷的問題。
 *
 * 邏輯與 supabase/functions/checkup-warrant-sync 相同：
 *   - regex per-record 抽取（容忍尾端截斷）
 *   - parent_code 反查 public.stock_names
 *   - exercise_ratio = 官方欄位 / 1000
 *
 * 用法：
 *   node scripts/refresh-warrant-basic.mjs           # 抓取 + 寫入 DB
 *   node scripts/refresh-warrant-basic.mjs --dry     # 只印 summary，不寫 DB
 *
 * 環境變數：
 *   SUPABASE_URL                  必填
 *   SUPABASE_SERVICE_ROLE_KEY     必填（非 dry 模式）
 */
import { createClient } from '@supabase/supabase-js'

const TWSE_LISTED = 'https://openapi.twse.com.tw/v1/opendata/t187ap37_L'
const DRY = process.argv.includes('--dry')

function rocToIso(s) {
  if (!s) return null
  const m = String(s).match(/^(\d{3,4})(\d{2})(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const gy = y < 1911 ? y + 1911 : y
  return `${gy}-${m[2]}-${m[3]}`
}

function parseRow(r) {
  const symbol = String(r['權證代號'] ?? '').trim()
  if (!/^\d{6}$/.test(symbol)) return null
  const name = String(r['權證簡稱'] ?? '').trim()
  const expire_date = rocToIso(r['履約截止日'])

  const rawRatio = String(r['最新標的履約配發數量(每仟單位權證)'] ?? '').replace(/,/g, '').trim()
  let exercise_ratio = null
  if (rawRatio) {
    const n = Number(rawRatio)
    if (Number.isFinite(n) && n > 0) exercise_ratio = n / 1000
  }
  const rawStrike = String(r['最新履約價格(元)/履約指數'] ?? '').replace(/,/g, '').trim()
  const strikeN = Number(rawStrike)
  const strike_price = Number.isFinite(strikeN) && strikeN > 0 ? strikeN : null

  const typ = String(r['權證類型'] ?? '').trim()
  const call_put = /認購/.test(typ) ? 'call' : /認售/.test(typ) ? 'put' : null
  const parentName = String(r['標的證券/指數'] ?? '').trim() || null

  return { symbol, name, parent_name: parentName, expire_date, exercise_ratio, strike_price, call_put }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required')
  if (!DRY && !SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (non-dry mode)')

  console.error(`[warrant-sync] fetching ${TWSE_LISTED} …`)
  const t0 = Date.now()
  const res = await fetch(TWSE_LISTED, {
    signal: AbortSignal.timeout(120_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 legendflow-warrant-sync/gha-1.0',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`)
  const text = await res.text()
  console.error(`[warrant-sync] fetched ${text.length} bytes in ${Date.now() - t0}ms`)

  // 寬容抽取：不整份 JSON.parse，避免尾端 unterminated string 全掛
  const re = /\{[^{}]*"權證代號":"\d{6}"[^{}]*\}/g
  const rows = []
  let m
  while ((m = re.exec(text))) {
    try { rows.push(JSON.parse(m[0])) } catch { /* skip */ }
  }
  console.error(`[warrant-sync] extracted ${rows.length} raw records`)

  const parsed = rows.map(parseRow).filter(Boolean)
  const withRatio = parsed.filter((p) => p.exercise_ratio !== null).length

  if (parsed.length === 0) {
    const summary = { ok: false, fetched_bytes: text.length, parsed: 0, hint: 'TWSE openapi returned 0 warrants — endpoint may have changed' }
    console.log(JSON.stringify(summary))
    process.exit(1)
  }

  if (DRY) {
    const summary = { ok: true, dry: true, fetched_bytes: text.length, parsed: parsed.length, with_ratio: withRatio, missing_ratio: parsed.length - withRatio, sample: parsed.slice(0, 3) }
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // parent_code 反查
  const names = [...new Set(parsed.map((p) => p.parent_name).filter(Boolean))]
  const parentMap = new Map()
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200)
    const { data, error } = await supabase.from('stock_names').select('symbol,name').in('name', chunk)
    if (error) throw new Error(`stock_names lookup failed: ${error.message}`)
    for (const s of data ?? []) {
      if (s.name && s.symbol) parentMap.set(s.name, s.symbol)
    }
  }
  console.error(`[warrant-sync] parent_code resolved for ${parentMap.size}/${names.length} parents`)

  const now = new Date().toISOString()
  const dedup = new Map()
  for (const p of parsed) {
    const row = {
      symbol: p.symbol,
      name: p.name,
      parent_code: p.parent_name ? parentMap.get(p.parent_name) ?? null : null,
      expire_date: p.expire_date,
      fetched_at: now,
    }
    if (p.exercise_ratio !== null) {
      row.exercise_ratio = p.exercise_ratio
      row.ratio_source = 'twse_t187ap37_L'
      row.ratio_updated_at = now
    }
    if (p.strike_price !== null) row.strike_price = p.strike_price
    if (p.call_put !== null) row.call_put = p.call_put
    dedup.set(p.symbol, row)
  }
  const finalRows = [...dedup.values()]

  const CHUNK = 500
  let written = 0
  for (let i = 0; i < finalRows.length; i += CHUNK) {
    const slice = finalRows.slice(i, i + CHUNK)
    const { error } = await supabase.from('warrant_expiry').upsert(slice, { onConflict: 'symbol' })
    if (error) throw new Error(`upsert failed at offset ${i}: ${error.message}`)
    written += slice.length
    console.error(`[warrant-sync] upserted ${written}/${finalRows.length}`)
  }

  const summary = {
    ok: true,
    fetched_bytes: text.length,
    parsed: parsed.length,
    with_ratio: withRatio,
    missing_ratio: parsed.length - withRatio,
    written,
    source: 'twse_t187ap37_L',
  }
  console.log(JSON.stringify(summary))
}

main().catch((err) => {
  console.error('[warrant-sync] FAILED:', err?.stack || err)
  console.log(JSON.stringify({ ok: false, error: String(err?.message || err) }))
  process.exit(1)
})
