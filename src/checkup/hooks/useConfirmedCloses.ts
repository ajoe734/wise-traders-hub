/**
 * useConfirmedCloses — 把已抓到的日 K（useSparklines）轉成「最後完整交易日收盤」
 * 身分卡，並確保休市日表已載入。
 *
 * 不發新請求：日 K 已經是看板列表既有的 fetch，這裡只做身分化，
 * 讓列表現價、抽屜 K 棒、匯出卡共用同一個 close 與同一個 tradeDate。
 */
import { useEffect, useMemo, useState } from 'react';
import { buildConfirmedClose, type ConfirmedClose, type SparklineLike } from '@/checkup/lib/confirmedClose';
import { latestCompletedTradeDate, holidaysLoaded } from '@/checkup/lib/marketCalendar';
import { loadMarketHolidays } from '@/checkup/lib/marketHolidaysLoader';

export interface ConfirmedCloseMap { [code: string]: ConfirmedClose }

export function useConfirmedCloses(
  sparklines: Record<string, SparklineLike> | null | undefined,
): {
  confirmedCloses: ConfirmedCloseMap;
  expectedTradeDate: string;
  calendarReady: boolean;
} {
  const [calendarReady, setCalendarReady] = useState(() => holidaysLoaded('TW'));

  useEffect(() => {
    let alive = true;
    loadMarketHolidays()
      .then((ok) => { if (alive && ok) setCalendarReady(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const codesKey = Object.keys(sparklines || {}).sort().join(',');

  return useMemo(() => {
    const map: ConfirmedCloseMap = {};
    for (const [code, entry] of Object.entries(sparklines || {})) {
      map[code] = buildConfirmedClose(code, entry);
    }
    return {
      confirmedCloses: map,
      expectedTradeDate: latestCompletedTradeDate(),
      calendarReady,
    };
    // codesKey 讓 sparkline 內容變動時重算；calendarReady 影響 pending reason
  }, [codesKey, calendarReady, sparklines]);
}

export default useConfirmedCloses;
