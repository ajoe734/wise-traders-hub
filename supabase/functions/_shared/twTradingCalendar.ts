/**
 * 台股交易日曆（Asia/Taipei）—— 全站唯一「非交易日」判定來源。
 *
 * 為什麼需要它：
 *   舊的 `tradingDate.ts` / `backfillDates.ts` 只跳週末，於是每個國定假日
 *   都會被當成「應該有資料卻缺資料」的交易日：
 *     1. gap 掃描永遠掃出幽靈缺口 → 佇列被塞爆、FinMind 配額被燒光。
 *     2. 1/5/10/20/60 日視窗以「日曆日」而非「交易日」回推 → 遇到連假時
 *        視窗內真正的交易日不足，前台顯示資料不全。
 *
 * 規則：
 *   - 週六、週日必為非交易日。
 *   - 內建 TWSE 國定假日表（BASE_HOLIDAYS，逐年維護）。
 *   - 額外假日（颱風假、臨時休市）由 `tw_market_holidays` 表以 `source='auto'`
 *     自動偵測補上，執行期以 `extra` 參數注入，不需要改碼。
 */

/** 內建 TWSE 休市日（不含週末）。逐年維護；臨時休市走 DB 自動偵測。 */
export const BASE_HOLIDAYS: readonly string[] = [
  // 2025
  '2025-01-01',
  '2025-01-23', '2025-01-24', '2025-01-27', '2025-01-28',
  '2025-01-29', '2025-01-30', '2025-01-31',
  '2025-02-28',
  '2025-04-03', '2025-04-04',
  '2025-05-01',
  '2025-05-30',
  '2025-10-06',
  '2025-10-10',
  // 2026
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-02-27',
  '2026-04-03', '2026-04-06',
  '2026-05-01',
  '2026-06-19',
  '2026-09-25',
  '2026-10-09',
  '2026-10-26',
  '2026-12-25',
];

const BASE_SET: ReadonlySet<string> = new Set(BASE_HOLIDAYS);

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export type HolidayInput = Iterable<string> | null | undefined;

/** 合併內建假日與執行期注入的額外假日。 */
export function holidaySet(extra?: HolidayInput): ReadonlySet<string> {
  if (!extra) return BASE_SET;
  const s = new Set(BASE_SET);
  for (const d of extra) if (ISO_RE.test(d)) s.add(d);
  return s;
}

export function isValidIso(iso: string): boolean {
  if (!ISO_RE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function isWeekendIso(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** 是否為台股交易日（非週末且不在假日表內）。 */
export function isTwTradingDay(iso: string, extra?: HolidayInput): boolean {
  if (!isValidIso(iso)) return false;
  if (isWeekendIso(iso)) return false;
  return !holidaySet(extra).has(iso);
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 往前找最近的交易日（含當日）。最多回推 30 天，避免超長連假時無限迴圈。 */
export function prevTwTradingDay(iso: string, extra?: HolidayInput): string {
  if (!isValidIso(iso)) return iso;
  const set = holidaySet(extra);
  let cur = iso;
  for (let i = 0; i < 30; i++) {
    if (!isWeekendIso(cur) && !set.has(cur)) return cur;
    cur = addDaysIso(cur, -1);
  }
  return cur;
}

/** 往後找最近的交易日（含當日）。 */
export function nextTwTradingDay(iso: string, extra?: HolidayInput): string {
  if (!isValidIso(iso)) return iso;
  const set = holidaySet(extra);
  let cur = iso;
  for (let i = 0; i < 30; i++) {
    if (!isWeekendIso(cur) && !set.has(cur)) return cur;
    cur = addDaysIso(cur, 1);
  }
  return cur;
}

/**
 * 以 `endIso`（含，若非交易日則先往前 roll）為終點，往回取 N 個「交易日」。
 * 回傳由舊到新。這是 1/5/10/20/60 日視窗的唯一正確算法：
 * 用交易日回推，連假不會讓視窗少資料。
 */
export function lastNTwTradingDays(
  endIso: string,
  n: number,
  extra?: HolidayInput,
): string[] {
  if (!isValidIso(endIso) || n <= 0) return [];
  const set = holidaySet(extra);
  const out: string[] = [];
  let cur = endIso;
  // 上限：n 個交易日最多不會超過 n*2 + 40 個日曆日（含連假）
  const maxSteps = n * 2 + 40;
  for (let i = 0; i < maxSteps && out.length < n; i++) {
    if (!isWeekendIso(cur) && !set.has(cur)) out.push(cur);
    cur = addDaysIso(cur, -1);
  }
  return out.reverse();
}

/** 列出 `[start, end]` 之間的所有交易日（跳週末與假日）。 */
export function enumerateTwTradingDates(
  start: string,
  end: string,
  extra?: HolidayInput,
): string[] {
  if (!isValidIso(start) || !isValidIso(end) || start > end) return [];
  const set = holidaySet(extra);
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    if (!isWeekendIso(cur) && !set.has(cur)) out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/** 兩個 ISO 日期之間的交易日差（不含起點、含終點；順序無關，回非負整數）。 */
export function twTradingDayDiff(from: string, to: string, extra?: HolidayInput): number {
  if (!isValidIso(from) || !isValidIso(to) || from === to) return 0;
  const [lo, hi] = from < to ? [from, to] : [to, from];
  return enumerateTwTradingDates(addDaysIso(lo, 1), hi, extra).length;
}

/** 台北曆日（UTC+8，無 DST）。 */
export function taipeiTodayIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 從 `tw_market_holidays` 載入額外假日（含手動與自動偵測）。
 * 失敗時回傳空陣列 —— 內建表仍可運作，絕不讓排程整個掛掉。
 */
export async function loadTwHolidays(
  // deno-lint-ignore no-explicit-any
  supa: any,
  fromIso: string,
  toIso: string,
): Promise<string[]> {
  try {
    const { data, error } = await supa
      .from('tw_market_holidays')
      .select('trade_date')
      .gte('trade_date', fromIso)
      .lte('trade_date', toIso);
    if (error) throw error;
    return (data ?? []).map((r: { trade_date: string }) => String(r.trade_date).slice(0, 10));
  } catch (e) {
    console.warn('[twTradingCalendar] loadTwHolidays failed:', (e as Error).message);
    return [];
  }
}

/** 以 6 小時 TTL 快取 DB 假日（含自動偵測的臨時休市），避免每個 job 都打一次 DB。 */
let _cache: { at: number; days: string[] } | null = null;
const CACHE_TTL_MS = 6 * 3600_000;

export async function getTwHolidaysCached(
  // deno-lint-ignore no-explicit-any
  supa: any,
  nowMs: number = Date.now(),
): Promise<string[]> {
  if (_cache && nowMs - _cache.at < CACHE_TTL_MS) return _cache.days;
  const from = new Date(nowMs - 400 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(nowMs + 400 * 86_400_000).toISOString().slice(0, 10);
  const days = await loadTwHolidays(supa, from, to);
  _cache = { at: nowMs, days };
  return days;
}

/** 測試用：清掉假日快取。 */
export function __resetTwHolidayCache() {
  _cache = null;
}
