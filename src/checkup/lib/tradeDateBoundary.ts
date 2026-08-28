/**
 * tradeDateBoundary — 「下一次 expected trade date 可能改變的時刻」純函式。
 *
 * 為什麼存在：持倉看板同一個 mount 可能從 13:30–14:05 的結算緩衝跨到 14:05 之後，
 * 此時 `latestCompletedTradeDate()` 會換日，但 React effect 沒有任何理由重跑。
 * 與其每分鐘輪詢，改成算出唯一一顆邊界 timer 的醒來時間（one-shot scheduler）。
 *
 * 契約：
 *   - 只支援 TW（Asia/Taipei 固定 UTC+8，無 DST）。
 *   - 回傳「嚴格大於 now」的下一個結算分界（14:05）epoch ms。
 *   - 週末／休市日不特別處理：timer 醒來後由 `latestCompletedTradeDate()`
 *     以真實 now 重算；expected 沒變就不會觸發任何 request（stable snapshot）。
 */
import { settleMinute } from './marketCalendar';

/** Asia/Taipei 固定 UTC+8。 */
const TAIPEI_OFFSET_MIN = 8 * 60;

function taipeiParts(now: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    minutes: hour * 60 + Number(get('minute')),
  };
}

/**
 * 下一次 expected trade date 可能改變的 epoch ms（台北 14:05，嚴格大於 now）。
 */
export function nextExpectedChangeAt(now: Date): number {
  const { y, m, d, minutes } = taipeiParts(now);
  const boundary = settleMinute('TW');
  // 台北當地牆上時間 → epoch：UTC 基準減去 +8 時區偏移
  const base = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TAIPEI_OFFSET_MIN * 60_000;
  const todayAt = base + boundary * 60_000;
  if (minutes < boundary) return todayAt;
  return todayAt + 86_400_000;
}

export default nextExpectedChangeAt;
