#!/usr/bin/env node
/**
 * refresh-finmind-industry.mjs
 *
 * 從 FinMind 公開 API 抓 `TaiwanStockInfo` dataset，作為 TWSE ISIN 主產業之外的
 * 「次產業 / 補完欄位」來源。免費、Apache 2.0，token 可選（未帶 token 走匿名 low-rate）。
 *
 * 產出：
 *   - data/finmind-industry-map.json       完整 dump（供 diff）
 *   - src/checkup/data/twseSecondaryIndustry.json   compact map（前端 bundle 用）
 *
 * 用法：
 *   node scripts/refresh-finmind-industry.mjs
 *   FINMIND_API_TOKEN=xxx node scripts/refresh-finmind-industry.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const FULL_OUT = resolve(HERE, '..', 'data', 'finmind-industry-map.json')
const COMPACT_OUT = resolve(HERE, '..', 'src', 'checkup', 'data', 'twseSecondaryIndustry.json')

async function fetchInfo() {
  const params = new URLSearchParams({ dataset: 'TaiwanStockInfo' })
  const token = process.env.FINMIND_API_TOKEN
  if (token) params.set('token', token)
  const url = `https://api.finmindtrade.com/api/v4/data?${params}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FinMind fetch failed: ${res.status}`)
  const json = await res.json()
  if (json.status !== 200 && !Array.isArray(json.data)) {
    throw new Error(`FinMind API error: ${JSON.stringify(json).slice(0, 200)}`)
  }
  return json.data || []
}

async function main() {
  console.log('Fetching FinMind TaiwanStockInfo…')
  const rows = await fetchInfo()
  console.log(`  received ${rows.length} rows`)

  const full = {}
  const compact = {
    _meta: {
      generatedAt: new Date().toISOString(),
      source: 'FinMind TaiwanStockInfo',
      schema: 'code -> industry_category (中文次產業，補 TWSE ISIN 主產業之空缺)',
      note: 'Auto-generated. Do NOT hand-edit.',
    },
  }
  let compactCount = 0
  for (const r of rows) {
    const code = String(r.stock_id || '').trim()
    if (!code) continue
    full[code] = {
      industry_category: r.industry_category || '',
      type: r.type || '',
      stock_name: r.stock_name || '',
      date: r.date || '',
    }
    if (/^\d{4}$/.test(code) && r.industry_category) {
      compact[code] = r.industry_category
      compactCount++
    }
  }

  writeFileSync(
    FULL_OUT,
    JSON.stringify(
      { _meta: { generatedAt: new Date().toISOString(), count: Object.keys(full).length }, ...full },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`Wrote ${Object.keys(full).length} entries → ${FULL_OUT}`)

  writeFileSync(COMPACT_OUT, JSON.stringify(compact), 'utf8')
  console.log(`Wrote ${compactCount} compact entries → ${COMPACT_OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
