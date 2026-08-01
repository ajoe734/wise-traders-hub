import { taipeiMondayOf } from '../_shared/weekBoundary.ts';

/** 週一 08:00 前仍屬前一個週記週期；其他時間使用當週。 */
export function reminderWeekStart(now: Date): string {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const isMondayBeforeOpen = taipei.getUTCDay() === 1 && taipei.getUTCHours() < 8;
  return taipeiMondayOf(isMondayBeforeOpen ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now);
}