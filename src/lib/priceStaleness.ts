/**
 * 持倉現價過期標示（純函式）。價格日期早於「最近應有收盤的交易日」時回傳 YYYY/MM/DD，
 * 讓畫面明示舊價；否則回傳 null。最近交易日以台北時間計：平日 14:30 後算當日，
 * 否則往前找最近的平日（國定休市日可能讓日期多顯示一天，寧可標示也不假裝是當日價）。
 */
const TAIPEI_OFFSET_MS = 8 * 3600_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function expectedCloseDate(now: Date = new Date()): string {
  const t = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  const day = t.getUTCDay();
  if (day >= 1 && day <= 5 && minutes >= 14 * 60 + 30) return ymd(t);
  do t.setUTCDate(t.getUTCDate() - 1); while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return ymd(t);
}

export function stalePriceLabel(priceDate: string | null | undefined, now: Date = new Date()): string | null {
  if (!priceDate) return null;
  const d = priceDate.slice(0, 10);
  if (d >= expectedCloseDate(now)) return null;
  return d.replace(/-/g, '/');
}
