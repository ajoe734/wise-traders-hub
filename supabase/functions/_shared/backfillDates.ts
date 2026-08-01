/**
 * BSR（TaiwanStockTradingDailyReport）只允許單日查詢：
 * 帶 end_date 會被上游擋成 HTTP 400
 * （"size is too large, we only send one day data"）。
 * 回補時必須把日期區間展開成逐日呼叫，且跳過非交易日
 * （週末＋國定假日，見 `_shared/twTradingCalendar.ts`）——
 * 對假日發查詢只會拿到空資料並白燒 FinMind 配額。
 */
import { enumerateTwTradingDates, type HolidayInput } from "./twTradingCalendar.ts";

export function enumerateTradingDates(
  start: string,
  end: string,
  extraHolidays?: HolidayInput,
): string[] {
  return enumerateTwTradingDates(start, end, extraHolidays);
}
