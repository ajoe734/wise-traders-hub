/**
 * marketHolidaysLoader — 把 `tw_market_holidays` 灌進 marketCalendar 的唯一入口。
 *
 * 為什麼分開放：marketCalendar 必須維持純函式可測；假日表是 I/O，
 * 由這裡在 App 啟動或看板掛載時載入一次（每日快取），失敗就維持
 * `holidaysLoaded=false`，讓 UI 顯示「待確認」而不是謊報已確認。
 */
import { getCheckupGateway } from './gateway';
import { setMarketHolidays, holidaysLoaded } from './marketCalendar';
import { taipeiDateKey } from './marketDataStatus';

let inflight: Promise<boolean> | null = null;
let loadedForDate: string | null = null;

/** 載入近兩年休市日；同一台北日期只打一次。 */
export async function loadMarketHolidays(force = false): Promise<boolean> {
  const today = taipeiDateKey();
  if (!force && loadedForDate === today && holidaysLoaded('TW')) return true;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const from = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await getCheckupGateway()
        .db.from('tw_market_holidays')
        .select('trade_date')
        .gte('trade_date', from);
      if (error || !Array.isArray(data)) return false;
      setMarketHolidays(data.map((r: { trade_date?: string }) => String(r?.trade_date || '')), 'TW');
      loadedForDate = today;
      return true;
    } catch {
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 測試用：清除載入狀態。 */
export function resetMarketHolidaysLoader(): void {
  inflight = null;
  loadedForDate = null;
}
