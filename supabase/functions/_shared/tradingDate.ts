// _shared/tradingDate.ts
// 台北時區交易日 helpers。
// 非交易日判定（週末＋國定假日）一律委派給 `_shared/twTradingCalendar.ts`，
// 這裡不再自行只跳週末 —— 連假期間 roll-back 若停在假日，
// 會導致 BSR/法人查到空資料並讓 1/5/10 日視窗缺一天。
// 日期一律以 ISO YYYY-MM-DD 字串表達；同一時區下的 ISO 字串詞典序 = 時間序。

import {
  isTwTradingDay,
  prevTwTradingDay,
  addDaysIso,
  twTradingDayDiff,
  type HolidayInput,
} from './twTradingCalendar.ts';

export function taipeiNowFrom(nowMs: number): Date {
  return new Date(nowMs + 8 * 3600 * 1000);
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return addDaysIso(iso, n);
}

/** 是否為台股交易日（非週末且非國定假日）。名稱沿用歷史，語意已含假日。 */
export function isWeekday(iso: string, extraHolidays?: HolidayInput): boolean {
  return isTwTradingDay(iso, extraHolidays);
}

/** 往前 roll 到最近的交易日（含當日）。 */
export function rollBackToWeekday(iso: string, extraHolidays?: HolidayInput): string {
  return prevTwTradingDay(iso, extraHolidays);
}

/** 台北時間是否已收盤（14:00 後 BSR 才有意義） */
export function isAfterCloseAt(nowMs: number): boolean {
  return taipeiNowFrom(nowMs).getUTCHours() >= 14;
}

export function decideEffectiveDate(
  nowMs: number,
  requestedDate: string | null,
  taipeiTodayIso: string,
  extraHolidays?: HolidayInput,
): { effective: string; rolled: boolean } {
  if (!requestedDate) {
    if (!isAfterCloseAt(nowMs)) {
      const effective = rollBackToWeekday(addDays(taipeiTodayIso, -1), extraHolidays);
      return { effective, rolled: effective !== taipeiTodayIso };
    }
    const effective = rollBackToWeekday(taipeiTodayIso, extraHolidays);
    return { effective, rolled: effective !== taipeiTodayIso };
  }
  const effective = rollBackToWeekday(requestedDate, extraHolidays);
  return { effective, rolled: effective !== requestedDate };
}

/**
 * 預期最新可用 BSR 交易日：
 *  - 台北時間收盤後（>=14:00） → 今天（若非交易日則往前 roll）
 *  - 收盤前 → 昨天往前 roll 至最近交易日
 * 已含國定假日（內建表 + 可注入的臨時休市）。
 */
export function expectedLatestBsrDate(nowMs: number, extraHolidays?: HolidayInput): string {
  const tp = taipeiNowFrom(nowMs);
  const today = toIsoDate(tp);
  if (isAfterCloseAt(nowMs)) return rollBackToWeekday(today, extraHolidays);
  return rollBackToWeekday(addDays(today, -1), extraHolidays);
}

/** 兩個 ISO 日期之間的交易日差（不含起點、含終點）。順序無關，回非負整數。 */
export function weekdayDiff(from: string, to: string, extraHolidays?: HolidayInput): number {
  return twTradingDayDiff(from, to, extraHolidays);
}
