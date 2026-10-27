/**
 * 證交所 MIS 即時報價批次查詢（Deno 與 Vitest 共用，純邏輯＋注入 fetch）。
 *
 * 根因（2026-10-27）：舊版每批 200 個 ex_ch，MIS 回 `rtmessage: "參數不足"` 與空陣列，
 * 整批靜默遺失，只有最後一小批成功 → 106 檔只更新約 30 檔，週記現價停在舊價數週。
 * 規則：每批 ≤ MIS_MAX_PARTS；回應非 OK 時對半拆批重試，直到單一代號；
 * 最終仍拿不到的代號回傳在 failed，讓呼叫端記錄並警示，不得靜默。
 */

export const MIS_MAX_PARTS = 60

export interface MisResponse {
  rtmessage?: string
  msgArray?: Array<Record<string, string>>
}

export type MisFetch = (exChParts: string[]) => Promise<MisResponse | null>

export function buildExChParts(symbol: string): string[] {
  const parts = [`tse_${symbol}.tw`, `otc_${symbol}.tw`]
  if (/^[03567]\d{5}$/.test(symbol) || symbol.length >= 6) parts.push(`oa_${symbol}.tw`)
  return parts
}

/** 依代號切批，同一代號的所有前綴必在同一批。 */
export function chunkSymbols(symbols: string[], maxParts = MIS_MAX_PARTS): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let n = 0
  for (const s of symbols) {
    const k = buildExChParts(s).length
    if (cur.length > 0 && n + k > maxParts) { out.push(cur); cur = []; n = 0 }
    cur.push(s); n += k
  }
  if (cur.length) out.push(cur)
  return out
}

function isOk(res: MisResponse | null): res is MisResponse {
  return !!res && String(res.rtmessage ?? 'OK').toUpperCase() === 'OK' && Array.isArray(res.msgArray)
}

/** 查詢一批；失敗則對半拆分遞迴。回傳所有 msg 與始終失敗的代號。 */
export async function fetchMisResilient(
  symbols: string[],
  fetchFn: MisFetch,
  maxParts = MIS_MAX_PARTS,
): Promise<{ items: Array<Record<string, string>>; failed: string[] }> {
  const items: Array<Record<string, string>> = []
  const failed: string[] = []
  const run = async (batch: string[]): Promise<void> => {
    let res: MisResponse | null = null
    try { res = await fetchFn(batch.flatMap(buildExChParts)) } catch { res = null }
    if (isOk(res)) { items.push(...res.msgArray!); return }
    if (batch.length === 1) { failed.push(batch[0]); return }
    const mid = Math.ceil(batch.length / 2)
    await run(batch.slice(0, mid))
    await run(batch.slice(mid))
  }
  for (const c of chunkSymbols(symbols, maxParts)) await run(c)
  return { items, failed }
}
