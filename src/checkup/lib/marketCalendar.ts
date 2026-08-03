/**
 * marketCalendar — 台股（及其他市場）「最後一個完整交易日」的**唯一資料源**。
 *
 * 為什麼存在：
 *   在 2026/08/04 00:38（台北）這種「已跨日但尚未開市」的時刻，任何要顯示
 *   「收盤價／日 K 衍生值」的欄位都必須對齊 2026/08/03。過去這個判斷散在
 *   `marketDataStatus.expectedTradeDate`、`marketClock.marketPhase`、各 Edge
 *   Function 與 SQL 裡，彼此對「今天算不算完整交易日」的定義不一致，於是同一
 *   畫面會混出 8/3 收盤、8/3 上午 quote、7/31 舊 cache 三種事實。
 *
 * 契約：
 *   - `latestCompletedTradeDate()` 只回傳「上游應該已經有完整日 K」的那一天。
 *   - 尚未收盤結算（台北 14:05 前）的今天**不算**完整交易日 → 回退前一交易日。
 *   - 週末與 `tw_market_holidays` 內的休市日一律回退。
 *   - 假日表是注入式的（`setMarketHolidays`）：沒載入時退化為「只跳週末」，
 *     此時 `holidaysLoaded=false`，UI 必須顯示「待確認」而不是謊報已確認。
 */

export type CalendarMarket = 'TW' | 'US';

export interface SessionPhase {
  /** 市場當地日期 YYYY-MM-DD */
  localDate: string;
  /** 市場當地分鐘數（0-1439） */
  localMinutes: number;
  /** 0=Sun … 6=Sat（市場當地） */
  dow: number;
  phase: 'pre_open' | 'open' | 'settling' | 'closed';
}

interface MarketRule {
  tz: string;
  openMin: number;
  closeMin: number;
  /** 收盤後多久，官方日 K 才視為「應該可取得」 */
  settleDelayMin: number;
}

const RULES: Record<CalendarMarket, MarketRule> = {
  // 台股 09:00–13:30，收盤後 35 分鐘（14:05）才期待官方日 K
  TW: { tz: 'Asia/Taipei', openMin: 9 * 60, closeMin: 13 * 60 + 30, settleDelayMin: 35 },
  US: { tz: 'America/New_York', openMin: 9 * 60 + 30, closeMin: 16 * 60, settleDelayMin: 20 },
};

/** 收盤＋緩衝後的「可期待日 K」分鐘門檻。 */
export function settleMinute(market: CalendarMarket = 'TW'): number {
  const r = RULES[market];
  return r.closeMin + r.settleDelayMin;
}

function parts(now: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // en-CA h23 邊界保險
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    localMinutes: hour * 60 + Number(get('minute')),
    dow: wdMap[get('weekday')] ?? 0,
  };
}

export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** ISO 日期 → 星期（0=Sun）。 */
export function isoDow(iso: string): number {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ── 休市日表（由 `tw_market_holidays` 注入；模組級單一資料源） ─────────────
const holidaySets: Record<CalendarMarket, Set<string>> = { TW: new Set(), US: new Set() };
const holidayLoaded: Record<CalendarMarket, boolean> = { TW: false, US: false };

export function setMarketHolidays(dates: Iterable<string>, market: CalendarMarket = 'TW'): void {
  const s = new Set<string>();
  for (const d of dates || []) {
    const iso = String(d || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) s.add(iso);
  }
  holidaySets[market] = s;
  holidayLoaded[market] = true;
}

export function resetMarketHolidays(market?: CalendarMarket): void {
  const list: CalendarMarket[] = market ? [market] : ['TW', 'US'];
  for (const m of list) { holidaySets[m] = new Set(); holidayLoaded[m] = false; }
}

export function marketHolidays(market: CalendarMarket = 'TW'): Set<string> {
  return holidaySets[market];
}

/** 假日表是否已載入；未載入時 UI 不得宣稱「已確認」。 */
export function holidaysLoaded(market: CalendarMarket = 'TW'): boolean {
  return holidayLoaded[market];
}

export interface CalendarOptions {
  market?: CalendarMarket;
  /** 覆寫休市日（測試用；不傳則用注入的全域表） */
  holidays?: Iterable<string> | null;
}

function holidaySetOf(opts?: CalendarOptions): Set<string> {
  if (opts?.holidays) {
    const s = new Set<string>();
    for (const d of opts.holidays) s.add(String(d).slice(0, 10));
    return s;
  }
  return holidaySets[opts?.market || 'TW'];
}

/** 該 ISO 日期是否為交易日（非週末、非休市日）。 */
export function isTradingDay(iso: string, opts?: CalendarOptions): boolean {
  const dow = isoDow(iso);
  if (dow === 0 || dow === 6) return false;
  return !holidaySetOf(opts).has(iso);
}

/** 嚴格往前找上一個交易日（不含自己）。 */
export function previousTradingDay(iso: string, opts?: CalendarOptions): string {
  let d = shiftIsoDate(iso, -1);
  for (let i = 0; i < 30; i += 1) {
    if (isTradingDay(d, opts)) return d;
    d = shiftIsoDate(d, -1);
  }
  return d;
}

/** 目前所處的盤別（純判定，不含休市日）。 */
export function sessionPhase(now: Date = new Date(), market: CalendarMarket = 'TW'): SessionPhase {
  const rule = RULES[market];
  const { localDate, localMinutes, dow } = parts(now, rule.tz);
  let phase: SessionPhase['phase'];
  if (localMinutes < rule.openMin) phase = 'pre_open';
  else if (localMinutes <= rule.closeMin) phase = 'open';
  else if (localMinutes < rule.closeMin + rule.settleDelayMin) phase = 'settling';
  else phase = 'closed';
  return { localDate, localMinutes, dow, phase };
}

/**
 * 「最後一個完整交易日」。所有『應使用收盤』的欄位都必須以此為 expected。
 *
 * 規則：
 *   1. 今天若是交易日且已過結算緩衝（TW 14:05）→ 今天。
 *   2. 否則往前找第一個交易日（跳週末與休市日）。
 */
export function latestCompletedTradeDate(now: Date = new Date(), opts?: CalendarOptions): string {
  const market = opts?.market || 'TW';
  const { localDate, localMinutes } = sessionPhase(now, market);
  const settledToday =
    isTradingDay(localDate, { market, holidays: opts?.holidays })
    && localMinutes >= settleMinute(market);
  if (settledToday) return localDate;
  return previousTradingDay(localDate, { market, holidays: opts?.holidays });
}

/** 兩個交易日之間相差幾個交易日（b 落後 a 幾天，負數代表超前）。 */
export function tradingDayLag(expected: string, actual: string, opts?: CalendarOptions): number {
  if (!expected || !actual) return 0;
  if (expected === actual) return 0;
  let lag = 0;
  let d = expected;
  for (let i = 0; i < 60; i += 1) {
    if (d === actual) return lag;
    if (d < actual) return -tradingDayLag(actual, expected, opts);
    d = previousTradingDay(d, opts);
    lag += 1;
  }
  return lag;
}
