// deno-lint-ignore-file no-explicit-any
/**
 * institutionalBackfill — per-stock 三大法人回補的純邏輯單一資料源。
 * 只做判定、夾值、聚合與分割，不碰網路與 DB，方便單元測試。
 */

/** 公開模式：只讀／回補 TWSE、FinMind 公開日報，免 cron key 與 admin。 */
export const PUBLIC_SYNC_MODES = new Set(["backfill_stock", "cold_start_status"]);

export const BACKFILL_COOLDOWN_MS = 60_000;

export function isPublicSyncMode(mode: unknown): boolean {
  return PUBLIC_SYNC_MODES.has(String(mode ?? ""));
}

/** 白名單：四碼且首位 1-9（排除 0050 這類 ETF 與非法輸入）。 */
export function isValidStockId(stockId: unknown): boolean {
  return /^[1-9]\d{3}$/.test(String(stockId ?? "").trim());
}

/** 回補天數：預設 60，夾在 1..120。 */
export function clampBackfillDays(days: unknown): number {
  const n = Number(days) || 60;
  return Math.min(Math.max(n, 1), 120);
}

/** 取得冷卻名額：可執行回 true 並記錄時間，冷卻中回 false。 */
export function takeCooldownSlot(
  map: Map<string, number>,
  stockId: string,
  now: number = Date.now(),
  cooldownMs: number = BACKFILL_COOLDOWN_MS,
): boolean {
  const last = map.get(stockId) ?? 0;
  if (now - last < cooldownMs) return false;
  map.set(stockId, now);
  return true;
}

export type InstitutionalRow = {
  stock_id: string;
  trade_date: string;
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
  raw: Record<string, unknown>;
};

/** FinMind 每天每個投資者類型一列 → 依 date 聚合成單日淨額。 */
export function aggregateInstitutionalRows(raw: any[], stockId: string): InstitutionalRow[] {
  const byDate = new Map<string, { fBuy: number; fSell: number; tBuy: number; tSell: number; dBuy: number; dSell: number }>();
  for (const r of raw ?? []) {
    const d = String(r?.date || "");
    if (!d) continue;
    const cur = byDate.get(d) || { fBuy: 0, fSell: 0, tBuy: 0, tSell: 0, dBuy: 0, dSell: 0 };
    const name = String(r?.name || "");
    const buy = Number(r?.buy || 0);
    const sell = Number(r?.sell || 0);
    if (name.startsWith("Foreign_Investor") || name === "Foreign_Investor" || name === "Foreign_Dealer_Self") {
      cur.fBuy += buy; cur.fSell += sell;
    } else if (name === "Investment_Trust") {
      cur.tBuy += buy; cur.tSell += sell;
    } else if (name.startsWith("Dealer")) {
      cur.dBuy += buy; cur.dSell += sell;
    }
    byDate.set(d, cur);
  }

  return Array.from(byDate.entries()).map(([date, v]) => {
    const foreign_net = v.fBuy - v.fSell;
    const trust_net = v.tBuy - v.tSell;
    const dealer_net = v.dBuy - v.dSell;
    return {
      stock_id: stockId,
      trade_date: date,
      foreign_net,
      trust_net,
      dealer_net,
      total_net: foreign_net + trust_net + dealer_net,
      raw: { source: "finmind_backfill" },
    };
  });
}

/**
 * 只有「已封存且已存在」的列會被 enforce_snapshot_immutability 擋（trigger 走 OLD），
 * 不存在的日期即使該日已封存仍可 insert。
 */
export function partitionWritableRows<T extends { trade_date: string }>(
  chunk: T[],
  sealed: Set<string>,
  existing: Set<string>,
): { writable: T[]; skipped: number } {
  const writable = (chunk ?? []).filter((r) => !(sealed.has(r.trade_date) && existing.has(r.trade_date)));
  return { writable, skipped: (chunk ?? []).length - writable.length };
}
