#!/usr/bin/env node
/**
 * refresh-stock-industry.mjs
 *
 * 從 TWSE / TPEx 公開資料抓取上市櫃個股「產業別」，產生 stockIndustry base map。
 *
 * 用途：作為 `src/checkup/data/stockIndustry.json` 的**主產業**基底。
 * 多族群拆分（industries[] + revenueMix）與題材（themes[]）仍需人工爬公司年報 / 產業報告補上。
 *
 * 資料源：
 *   - TWSE 上市：https://isin.twse.com.tw/isin/C_public.jsp?strMode=2
 *   - TPEx 上櫃：https://isin.twse.com.tw/isin/C_public.jsp?strMode=4
 *   （官方 ISIN 表，欄位含「產業別」，Big5 編碼）
 *
 * 用法：
 *   node scripts/refresh-stock-industry.mjs
 *   → 產生 src/checkup/data/twse-industry-map.json （不覆蓋人工維護的 stockIndustry.json）
 *
 * 後續：人工 diff 兩份檔案，把新增/變更的個股補進 stockIndustry.json 並校訂 revenueMix。
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import iconv from 'iconv-lite'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'src', 'checkup', 'data', 'twse-industry-map.json')

const SOURCES = [
  { mode: 2, label: '上市' },
  { mode: 4, label: '上櫃' },
]

async function fetchOne(mode) {
  const url = `https://isin.twse.com.tw/isin/C_public.jsp?strMode=${mode}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch mode=${mode} failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return iconv.decode(buf, 'big5')
}

function parseHtml(html) {
  // <tr><td>2330　台積電</td><td>...</td>...<td>半導體業</td>...</tr>
  const rows = []
  const re = /<tr>([\s\S]*?)<\/tr>/g
  let m
  while ((m = re.exec(html))) {
    const tds = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(
      (x) => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
    )
    if (tds.length < 6) continue
    const codeName = tds[0].split(/\s+/)
    const code = codeName[0]
    const name = codeName.slice(1).join(' ')
    if (!/^\d{4,6}$/.test(code)) continue
    const industry = tds[4] || tds[5] || ''
    if (!industry) continue
    rows.push({ code, name, industry })
  }
  return rows
}

async function main() {
  const all = {}
  for (const s of SOURCES) {
    console.log(`Fetching ${s.label} (mode=${s.mode})…`)
    const html = await fetchOne(s.mode)
    const rows = parseHtml(html)
    console.log(`  parsed ${rows.length} rows`)
    for (const r of rows) {
      all[r.code] = {
        industries: [r.industry],
        source: `twse-isin-mode${s.mode}`,
        updatedAt: new Date().toISOString().slice(0, 10),
        name: r.name,
      }
    }
  }
  const output = { _meta: { generatedAt: new Date().toISOString(), count: Object.keys(all).length }, ...all }
  writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8')
  console.log(`Wrote ${Object.keys(all).length} entries → ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
