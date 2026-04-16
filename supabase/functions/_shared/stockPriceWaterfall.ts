/**
 * 取價瀑布邏輯（Deno Edge Function 與 Vitest 共用）
 *
 * 欄位對照（TWSE MsgItem）：
 *   z  最後成交價
 *   h  最高價
 *   v  成交量
 *   a  委賣價（底線分隔，取第一檔）
 *   y  昨日收盤價
 *
 * ⚠️ 此檔案與 src/lib/stockPriceWaterfall.ts 必須保持完全一致。
 *    Vitest 測試以 src/lib/ 版本為準；Edge Function 以此版本為準。
 *    任何邏輯異動請同步修改兩份檔案，並由 1.2 測試的 drift-detection 驗證。
 */

export interface MsgItem {
  c: string   // code
  n: string   // name
  z: string   // latest trade price
  a: string   // best ask (underscore-separated)
  b: string   // best bid (underscore-separated)
  y: string   // yesterday close
  o: string   // open
  h: string   // high
  l: string   // low
  v: string   // volume
  u: string   // limit up
  w: string   // limit down
  ex: string  // exchange type
}

export function parsePrice(val: string | undefined): number | null {
  if (!val || val === '-') return null
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

/** 4-layer waterfall: z > h(有量) > a(first ask) > y */
export function extractPrice(item: MsgItem): number | null {
  const z = parsePrice(item.z)
  if (z && z > 0) return z

  const h = parsePrice(item.h)
  const v = parseInt(item.v || '0', 10)
  if (h && h > 0 && v > 0) return h

  const aFirst = item.a?.split('_')?.[0]
  const a = parsePrice(aFirst)
  if (a && a > 0) return a

  return parsePrice(item.y)
}

/** 外層 caller 用：price > 0（排除 null / 0 / 負數）才寫入 DB */
export function shouldWritePrice(price: number | null): boolean {
  return price !== null && price > 0
}
