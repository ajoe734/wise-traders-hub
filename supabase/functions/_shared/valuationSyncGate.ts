/**
 * market_day gate —— 純邏輯（VALUATION_THREE_RULERS_PLAN_V1 · 資料鏈防呆）
 *
 * 背景：market_day cron（16:30 台北）曾因 FinMind 當日資料未出全，
 * 只寫入 ~79 筆且無補抓、無告警（9/23–10/02 停擺）。本模組把「跳過 / 補跑 / 告警」
 * 的判定抽成純函式，供 valuation-sync 與 Vitest 共用。
 */

/** 全市場單日寫入量的健康門檻（低於此視為資料未出全，需要補跑）。 */
export const MARKET_DAY_MIN_ROWS = 1500;

export type MarketDayGate = {
  /** 已有足量資料 → 跳過本輪（晚間補跑 cron 不會重複打 API）。 */
  skip: boolean;
  /** skip 時的原因。 */
  reason: 'already_full' | null;
  /** 寫入筆數落在 (0, minRows) → 資料疑似未出全，應寫 system_alerts。 */
  lowRows: boolean;
  /** 寫入 0 筆 → 可能為非交易日，僅記 log 不告警。 */
  empty: boolean;
};

export function evaluateMarketDayGate(
  existingCount: number | null,
  upserted: number,
  minRows: number = MARKET_DAY_MIN_ROWS,
  force = false,
): MarketDayGate {
  const full = existingCount != null && existingCount >= minRows;
  const skip = !force && full;
  return {
    skip,
    reason: skip ? 'already_full' : null,
    lowRows: upserted > 0 && upserted < minRows,
    empty: upserted === 0,
  };
}
