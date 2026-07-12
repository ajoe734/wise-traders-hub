/**
 * Taipei-based week boundary helpers.
 *
 * 「一週」以 Asia/Taipei（UTC+8，無 DST）的週一 00:00 為起點、
 * 下週一 00:00 為終點（不含）。所有 week_start 皆以 Taipei 曆日
 * `YYYY-MM-DD` 表示。
 *
 * 這裡的邏輯同時被 edge function (expert-ai-training) 與 vitest
 * 單元測試使用；請勿在呼叫端再另行手算 UTC 邊界。
 */

const MS_PER_DAY = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 將 UTC Date 轉為「台北時鐘」下的 Date（其 UTC 欄位等於台北牆上時間）。 */
function toTaipeiClock(d: Date): Date {
  return new Date(d.getTime() + TAIPEI_OFFSET_MS);
}

/**
 * 取得 `d`（UTC 時間）在 Asia/Taipei 曆法下所屬那週的週一（YYYY-MM-DD）。
 * 週一 00:00 台北為分界（含）。
 */
export function taipeiMondayOf(d: Date): string {
  const shifted = toTaipeiClock(d);
  const day = shifted.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7;      // Monday=0
  const monday = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - diff,
    ),
  );
  return monday.toISOString().slice(0, 10);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new Error(`invalid weekStart: ${weekStart}`);
  }
  const start = new Date(`${weekStart}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`invalid weekStart: ${weekStart}`);
  }
  const end = new Date(start.getTime() + 7 * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * 判斷 `d`（UTC）是否落在指定 Taipei 週 `[週一 00:00, 下週一 00:00)` 內。
 */
export function isInTaipeiWeek(d: Date, weekStart: string): boolean {
  const { startIso, endIso } = taipeiWeekRangeUtc(weekStart);
  const t = d.getTime();
  return t >= new Date(startIso).getTime() && t < new Date(endIso).getTime();
}
