/**
 * partialSeries — 日 K 歷史不足時的「單一提示」契約。
 *
 * 為什麼存在：上游只回 1–4 根時，畫面會同時冒出「5 日均量 資料不足 2/5」、
 * 「20 日均量 資料不足 1/20」、「相對量能 —」、「近 60 日無明確壓力區」四條
 * 互相重複的雜訊。這裡把它收斂成一句話，並明確關閉均量／壓力／轉折判讀。
 *
 * 守門：src/checkup/lib/partialSeries.test.ts
 */
import { KLINE_SLOTS } from './klineXScale';

/** 少於這個根數 → partial 模式（只顯示一條提示，不做任何量價判讀）。 */
export const PARTIAL_BAR_THRESHOLD = 5;
/** 達到這個根數 → 回復完整 metrics。 */
export const FULL_METRIC_BAR_THRESHOLD = 20;

export interface PartialSeriesState {
  /** 是否進入 partial 模式（關閉 MA／相對量能／壓力／轉折） */
  partial: boolean;
  /** 是否可顯示完整 metrics */
  full: boolean;
  count: number;
  slots: number;
  /** partial 模式下的唯一提示文字；否則 null */
  text: string | null;
}

export function resolvePartialSeries(count: number, slots: number = KLINE_SLOTS): PartialSeriesState {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const partial = n > 0 && n < PARTIAL_BAR_THRESHOLD;
  return {
    partial,
    full: n >= FULL_METRIC_BAR_THRESHOLD,
    count: n,
    slots,
    text: partial ? `日 K 資料暫時不完整（${n}/${slots}），均量與壓力暫不判讀` : null,
  };
}
