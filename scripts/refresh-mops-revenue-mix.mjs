#!/usr/bin/env node
/**
 * refresh-mops-revenue-mix.mjs
 *
 * 從公開資訊觀測站 MOPS `t164sb04`（產品營收比重）抓個股各業務營收拆分，
 * 產出建議 `revenueMix` JSON，供人工 review 後合併進 stockIndustry.json。
 *
 * 只針對 Top 20 熱門持倉 + CLI 傳入的股票代號執行，避免打爆 MOPS。
 * 內建 3 秒 delay + 每次最多 20 檔。
 *
 * 用法：
 *   node scripts/refresh-mops-revenue-mix.mjs 2330 2317 2454
 *   node scripts/refresh-mops-revenue-mix.mjs --from-overlay   # 讀 stockIndustry.json 已有 revenueMix 的清單
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import iconv from 'iconv-lite'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'data', 'mops-revenue-mix.json')
const OVERLAY = resolve(HERE, '..', 'src', 'checkup', 'data', 'stockIndustry.json')

const MAX_CODES = 20
const DELAY_MS = 3000

function pickCodes() {
  const args = process.argv.slice(2)
  if (args.includes('--from-overlay')) {
    const j = JSON.parse(readFileSync(OVERLAY, 'utf8'))
    return Object.entries(j)
      .filter(([k, v]) => !k.startsWith('_') && Array.isArray(v?.revenueMix) && v.revenueMix.length)
      .map(([k]) => k)
  }
  return args.filter((a) => /^\d{4,6}$/.test(a))
}

async function fetchOne(code) {
  // MOPS t164sb04：個股「產品營業額」季報，取最新一季
  const now = new Date()
  const rocYear = now.getFullYear() - 1911
  const season = Math.max(1, Math.floor((now.getMonth() + 1) / 3)) // 粗估最近可用季
  const body = new URLSearchParams({
    encodeURIComponent: '1',
    step: '1',
    firstin: '1',
    off: '1',
    isnew: 'true',
    co_id: code,
    year: String(rocYear),
    season: String(season).padStart(2, '0'),
  })
  const res = await fetch('https://mops.twse.com.tw/mops/web/ajax_t164sb04', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`MOPS ${code} status ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const html = iconv.decode(buf, 'utf8')
  return parseRevenueTable(html)
}

function parseRevenueTable(html) {
  // 尋找「產品／營業額／百分比」表格，抓 name + pct
  const out = []
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m
  while ((m = rowRe.exec(html))) {
    const tds = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((x) =>
      x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
    )
    if (tds.length < 3) continue
    const name = tds[0]
    // 找最後一個是 xx.xx% 或純小數的欄位
    const pctCell = tds.slice(1).reverse().find((c) => /^-?\d+(\.\d+)?%?$/.test(c))
    if (!pctCell || !name || /合計|總計|Total/i.test(name)) continue
    const pct = parseFloat(pctCell.replace('%', ''))
    if (Number.isFinite(pct) && pct > 0) out.push({ product: name, pct })
  }
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let codes = pickCodes()
  if (codes.length === 0) {
    console.error('Usage: node scripts/refresh-mops-revenue-mix.mjs <code> [<code> …]')
    console.error('   or: node scripts/refresh-mops-revenue-mix.mjs --from-overlay')
    process.exit(1)
  }
  if (codes.length > MAX_CODES) {
    console.warn(`⚠️  Truncating ${codes.length} → ${MAX_CODES} to avoid MOPS rate limit`)
    codes = codes.slice(0, MAX_CODES)
  }

  const results = {}
  for (const [i, code] of codes.entries()) {
    try {
      console.log(`[${i + 1}/${codes.length}] fetch ${code}…`)
      const products = await fetchOne(code)
      results[code] = { products, fetchedAt: new Date().toISOString() }
      console.log(`  → ${products.length} products`)
    } catch (e) {
      console.warn(`  ⚠️  ${code} failed: ${e.message}`)
      results[code] = { error: e.message, fetchedAt: new Date().toISOString() }
    }
    if (i < codes.length - 1) await sleep(DELAY_MS)
  }

  writeFileSync(
    OUT,
    JSON.stringify({ _meta: { generatedAt: new Date().toISOString(), count: codes.length }, ...results }, null, 2),
    'utf8',
  )
  console.log(`Wrote ${OUT}`)
  console.log('⚠️  MOPS 產品名稱不等於產業別，需人工把 products → industries 對照後再合進 stockIndustry.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
