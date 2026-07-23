// _shared/tradingDate.ts
// 台北時區交易日 helpers（週末 roll-back；不含國定假日）。
// 從 tw-bsr-finmind-sync/lib.ts 遷出，讓 tw-chips-detail 與 sync 共用同一份日期邏輯。
// 日期一律以 ISO YYYY-MM-DD 字串表達；同一時區下的 ISO 字串詞典序 = 時間序，可直接以 `<` `>` 比較。

export function taipeiNowFrom(nowMs: number): Date {
  return new Date(nowMs + 8 * 3600 * 1000);
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekday(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6;
}

export function rollBackToWeekday(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/** 台北時間是否已收盤（14:00 後 BSR 才有意義） */
export function isAfterCloseAt(nowMs: number): boolean {
  return taipeiNowFrom(nowMs).getUTCHours() >= 14;
}

export function decideEffectiveDate(
  nowMs: number,
  requestedDate: string | null,
  taipeiTodayIso: string,
): { effective: string; rolled: boolean } {
  if (!requestedDate) {
    if (!isAfterCloseAt(nowMs)) {
      const effective = rollBackToWeekday(addDays(taipeiTodayIso, -1));
      return { effective, rolled: effective !== taipeiTodayIso };
    }
    const effective = rollBackToWeekday(taipeiTodayIso);
    return { effective, rolled: effective !== taipeiTodayIso };
  }
  const effective = rollBackToWeekday(requestedDate);
  return { effective, rolled: effective !== requestedDate };
}

/**
 * 預期最新可用 BSR 交易日：
 *  - 台北時間收盤後（>=14:00） → 今天（若週末則往前 roll）
 *  - 收盤前 → 昨天往前 roll 至最近交易日
 * 已知限制：不含國定假日，因此對外文案避免出現「已落後 N 個交易日」，
 * 只做 weekday 差（`bsr_lag_weekdays`）與資料日期較預期落後的軟提示。
 */
export function expectedLatestBsrDate(nowMs: number): string {
  const tp = taipeiNowFrom(nowMs);
  const today = toIsoDate(tp);
  if (isAfterCloseAt(nowMs)) return rollBackToWeekday(today);
  return rollBackToWeekday(addDays(today, -1));
}

/** 兩個 ISO 日期之間的 weekday 差（不含起點、含終點）。順序無關，回非負整數。 */
export function weekdayDiff(from: string, to: string): number {
  if (from === to) return 0;
  const [lo, hi] = from < to ? [from, to] : [to, from];
  let d = lo;
  let n = 0;
  while (d < hi) {
    d = addDays(d, 1);
    if (isWeekday(d)) n += 1;
  }
  return n;
}
