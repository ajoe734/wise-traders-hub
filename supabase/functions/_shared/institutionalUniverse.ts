// 法人日報 universe 收斂 + 寫入成本控制（單一資料源）
//
// 為什麼存在（成本事故 2026-08-30）：
//   1. tw_institutional_daily 已 19M 列 / 5.5GB。每日全市場 upsert 把權證、
//      ETF、受益證券、外國股一起寫進來，其中大多數沒有任何持倉會查詢。
//   2. keep-warm 每次都是「全量 upsert」，即使值完全沒變也會產生 dead tuple，
//      autovacuum 追不上 → 表膨脹 + DB CPU 長期偏高。
//   3. 多個 wave / cold-start 同時跑同一天，互相重工。
//
// 三個對策都放這裡，禁止各 function 自刻：
//   A. isCommonStockId  → 只收 4 碼普通股（1000–9999）
//   B. deltaUpsertInstitutional → 值沒變就不寫
//   C. acquireSyncLease → DB-backed 租約，同一 key 同時只有一個 runner

export type InstitutionalRow = {
  stock_id: string;
  trade_date: string;
  foreign_net: number | null;
  trust_net: number | null;
  dealer_net: number | null;
  total_net: number | null;
  [k: string]: unknown;
};

/**
 * 4 碼普通股：1000–9999。
 *
 * 排除：
 *   - 0050 / 00878 等 ETF（開頭 0）
 *   - 6 碼權證（03xxxx、7xxxxx）
 *   - 帶英文字母的存託憑證 / 特別股（2891B、9105 以外的 xxxxA…）
 *   - 空值 / 非數字
 */
export function isCommonStockId(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  return /^[1-9][0-9]{3}$/.test(s);
}

export function filterCommonStockRows<T extends { stock_id?: unknown }>(
  rows: T[],
): { kept: T[]; droppedCount: number } {
  const kept: T[] = [];
  let droppedCount = 0;
  for (const r of rows) {
    if (isCommonStockId(r?.stock_id)) kept.push(r);
    else droppedCount += 1;
  }
  return { kept, droppedCount };
}

const NET_FIELDS = ['foreign_net', 'trust_net', 'dealer_net', 'total_net'] as const;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sameNets(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const f of NET_FIELDS) {
    if (num(a[f]) !== num(b[f])) return false;
  }
  return true;
}

/**
 * 只寫「新的」或「四個淨額有變」的列。
 *
 * 回傳統計讓呼叫端可以記錄成本節省（skipped 即避免掉的 dead tuple 數）。
 */
export async function deltaUpsertInstitutional(
  supa: any,
  rows: InstitutionalRow[],
  opts: { tradeDate: string; source: string; batch?: number },
): Promise<{ written: number; skipped: number; dropped: number; error?: string }> {
  const { kept, droppedCount } = filterCommonStockRows(rows);
  if (kept.length === 0) return { written: 0, skipped: 0, dropped: droppedCount };

  const { data: existing } = await supa
    .from('tw_institutional_daily')
    .select('stock_id,foreign_net,trust_net,dealer_net,total_net')
    .eq('trade_date', opts.tradeDate)
    .in('stock_id', kept.map((r) => String(r.stock_id)));

  const prior = new Map<string, Record<string, unknown>>();
  for (const e of existing || []) prior.set(String((e as any).stock_id), e as any);

  const changed = kept.filter((r) => {
    const p = prior.get(String(r.stock_id));
    return !p || !sameNets(r as Record<string, unknown>, p);
  });
  const skipped = kept.length - changed.length;
  if (changed.length === 0) return { written: 0, skipped, dropped: droppedCount };

  const BATCH = opts.batch ?? 500;
  let written = 0;
  for (let i = 0; i < changed.length; i += BATCH) {
    const chunk = changed.slice(i, i + BATCH).map((r) => ({ ...r, raw: { source: opts.source } }));
    const { error } = await supa
      .from('tw_institutional_daily')
      .upsert(chunk, { onConflict: 'stock_id,trade_date' });
    if (error) return { written, skipped, dropped: droppedCount, error: `upsert_failed:${error.message}` };
    written += chunk.length;
  }
  return { written, skipped, dropped: droppedCount };
}

/**
 * DB-backed 租約（沿用既有 tw_bsr_sync_locks 表，不新增 schema）。
 *
 * 取得成功才可以跑重工作；過期的租約會被覆寫，所以 runner 崩潰不會永久卡死。
 */
export async function acquireSyncLease(
  supa: any,
  lockKey: string,
  ttlSeconds: number,
): Promise<boolean> {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  const { error } = await supa
    .from('tw_bsr_sync_locks')
    .insert({ lock_key: lockKey, acquired_at: now.toISOString(), expires_at: expires });
  if (!error) return true;

  // 已存在 → 只有在過期時才搶得到
  const { data: taken } = await supa
    .from('tw_bsr_sync_locks')
    .update({ acquired_at: now.toISOString(), expires_at: expires })
    .eq('lock_key', lockKey)
    .lt('expires_at', now.toISOString())
    .select('lock_key');
  return Array.isArray(taken) && taken.length > 0;
}

export async function releaseSyncLease(supa: any, lockKey: string): Promise<void> {
  try {
    await supa.from('tw_bsr_sync_locks').delete().eq('lock_key', lockKey);
  } catch { /* best-effort */ }
}
