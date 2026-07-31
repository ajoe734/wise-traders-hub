/**
 * 全站唯一的「週界線」來源（Asia/Taipei）。
 *
 * 一週 = Taipei 週一 00:00（含）～ 下週一 00:00（不含）。UTC+8 無 DST。
 *
 * 前台任何地方都不准再用 `date-fns` 的 `startOfWeek(d, { weekStartsOn: 1 })`：
 * 那是「瀏覽器本地時區」的週一，使用者人在美國時會整整差一天，導致週記
 * 分組、匯出範圍、PDF 標題全部錯位。
 *
 * 本檔為 `supabase/functions/_shared/weekBoundary.ts` 的前台鏡像，
 * 三個核心函式（taipeiMondayOf / taipeiWeekRangeUtc / isInTaipeiWeek）
 * 行為必須逐字一致，由 `src/test/unit/taipeiWeek.test.ts` 的 parity 測試守門。
 */

const MS_PER_DAY = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 將 UTC Date 轉為「台北時鐘」下的 Date（其 UTC 欄位等於台北牆上時間）。 */
function toTaipeiClock(d: Date): Date {
  return new Date(d.getTime() + TAIPEI_OFFSET_MS);
}

/**
 * 取得 `d` 在 Asia/Taipei 曆法下所屬那週的週一（YYYY-MM-DD）。
 * 週一 00:00 台北為分界（含）。
 */
export function taipeiMondayOf(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${String(d)}`);
  const shifted = toTaipeiClock(date);
  const day = shifted.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // Monday=0
  const monday = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - diff),
  );
  return monday.toISOString().slice(0, 10);
}

export interface TaipeiClock {
  /** 台北曆日 `YYYY-MM-DD` */
  date: string;
  /** 0=週日 … 6=週六（台北曆法） */
  day: number;
  hour: number;
  minute: number;
  /** `hour * 100 + minute`，方便做時刻比較 */
  hhmm: number;
}

/**
 * 取得指定時刻在 Asia/Taipei 的「牆上時鐘」資訊。
 * 全站唯一的台北時鐘來源：發布視窗、收回判定等都必須用它，
 * 不得再自行手刻 `+8 小時` 位移。
 */
export function taipeiClockOf(d: Date | string | number = new Date()): TaipeiClock {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${String(d)}`);
  const tw = toTaipeiClock(date);
  const hour = tw.getUTCHours();
  const minute = tw.getUTCMinutes();
  return {
    date: tw.toISOString().slice(0, 10),
    day: tw.getUTCDay(),
    hour,
    minute,
    hhmm: hour * 100 + minute,
  };
}

/** 指定時刻的台北曆日 `YYYY-MM-DD`。 */
export function taipeiDateIso(d: Date | string | number = new Date()): string {
  return taipeiClockOf(d).date;
}

export interface TaipeiWeekRange {
  /** Taipei 週一 00:00 對應的 UTC ISO 字串 */
  startIso: string;
  /** 下週一 00:00（不含）對應的 UTC ISO 字串 */
  endIso: string;
}

/**
 * 由 Taipei 週一日期字串 `YYYY-MM-DD` 取得該週在 UTC 時間軸上的
 * `[start, end)` 半開區間，供資料庫 `.gte / .lt` 查詢使用。
 */
export function taipeiWeekRangeUtc(weekStart: string): TaipeiWeekRange {
  if (!ISO_DATE_RE.test(weekStart)) throw new Error(`invalid weekStart: ${weekStart}`);
  const start = new Date(`${weekStart}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) throw new Error(`invalid weekStart: ${weekStart}`);
  const end = new Date(start.getTime() + 7 * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** 判斷 `d` 是否落在指定 Taipei 週 `[週一 00:00, 下週一 00:00)` 內。 */
export function isInTaipeiWeek(d: Date | string | number, weekStart: string): boolean {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return false;
  const { startIso, endIso } = taipeiWeekRangeUtc(weekStart);
  const t = date.getTime();
  return t >= new Date(startIso).getTime() && t < new Date(endIso).getTime();
}

/**
 * 週內第 N 天（0=週一 … 6=週日）的 Taipei 曆日 `YYYY-MM-DD`。
 * 純字串運算，不受瀏覽器時區影響。
 */
export function taipeiWeekDayIso(weekStart: string, offsetDays: number): string {
  if (!ISO_DATE_RE.test(weekStart)) throw new Error(`invalid weekStart: ${weekStart}`);
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** 該週週五（第 5 個交易日）的 Taipei 曆日。 */
export function taipeiWeekFridayIso(weekStart: string): string {
  return taipeiWeekDayIso(weekStart, 4);
}

/** 該週週日（最後一天）的 Taipei 曆日。 */
export function taipeiWeekSundayIso(weekStart: string): string {
  return taipeiWeekDayIso(weekStart, 6);
}

/**
 * 把 Taipei 曆日字串轉成「本地欄位等於該曆日」的 Date，
 * 供 `date-fns` 之類以本地欄位輸出的格式化器安全使用（純顯示用途，
 * 不可拿去做時間比較或查詢）。
 */
export function taipeiIsoToDisplayDate(iso: string): Date {
  if (!ISO_DATE_RE.test(iso)) throw new Error(`invalid iso date: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** `YYYY-MM-DD` → `MM/DD`（顯示用）。 */
export function formatIsoMD(iso: string): string {
  if (!ISO_DATE_RE.test(iso)) return '';
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

/** `YYYY-MM-DD` → `YYYY/MM/DD`（顯示用，符合全站日期規範）。 */
export function formatIsoYMD(iso: string): string {
  if (!ISO_DATE_RE.test(iso)) return '';
  return iso.replace(/-/g, '/');
}

/** 週一～週五的顯示區間字串，例如 `06/08 ~ 06/12`。 */
export function taipeiWeekRangeLabelMD(weekStart: string): string {
  return `${formatIsoMD(weekStart)} ~ ${formatIsoMD(taipeiWeekFridayIso(weekStart))}`;
}
