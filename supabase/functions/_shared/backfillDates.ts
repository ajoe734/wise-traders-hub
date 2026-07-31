/**
 * BSR（TaiwanStockTradingDailyReport）只允許單日查詢：
 * 帶 end_date 會被上游擋成 HTTP 400
 * （"size is too large, we only send one day data"）。
 * 回補時必須把日期區間展開成逐日呼叫，且跳過週末（台股不開盤）。
 */
export function enumerateTradingDates(start: string, end: string): string[] {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) return [];
  const out: string[] = [];
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
