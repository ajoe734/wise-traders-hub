/**
 * 訂閱者即將到期 → 老師端顯示用純函式（單一資料源：DB RPC `expiring_subscriptions_for_expert`）。
 * 天數／本地日一律由 server 以老師時區計算；前端只負責格式化與 dismiss 判斷，不重算 days_left。
 */

export const SUBSCRIBER_EXPIRY_NOTIFICATION_TYPE = 'subscriber_expiry_reminder';
export const DEFAULT_JOURNAL_REMINDER_TIME = '18:00';
export const DEFAULT_JOURNAL_REMINDER_TIMEZONE = 'Asia/Taipei';

export interface ExpiringSubscriberRow {
  subscription_id: string;
  display_name: string;
  plan_name: string | null;
  plan_type: string | null;
  expires_at: string;
  expires_on: string; // YYYY-MM-DD（server 依老師時區）
  days_left: number;
  local_date: string; // YYYY-MM-DD（server 依老師時區的「今天」）
}

export function reminderTitle(count: number): string {
  return `${count} 位訂閱者將於 7 日內到期`;
}

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft <= 0) return '今日到期';
  if (daysLeft === 1) return '明日到期';
  return `剩 ${daysLeft} 天`;
}

/** YYYY-MM-DD → YYYY/MM/DD；已是斜線格式則原樣。 */
export function formatExpiresOn(expiresOn: string): string {
  return String(expiresOn || '').slice(0, 10).replace(/-/g, '/');
}

/** 依 days_left、expires_at、display_name 排序（與 server ORDER BY 一致，防禦性）。 */
export function sortExpiring(rows: ExpiringSubscriberRow[]): ExpiringSubscriberRow[] {
  return [...rows].sort((a, b) =>
    a.days_left - b.days_left
    || String(a.expires_at).localeCompare(String(b.expires_at))
    || String(a.display_name).localeCompare(String(b.display_name), 'zh-Hant'));
}

/** 被老師「今天先收起」的 dismiss key：同老師同本地日。 */
export function dismissKey(expertId: string, localDate: string): string {
  return `${expertId}:${localDate}`;
}

export function isDismissed(dismissed: string[] | undefined, expertId: string, localDate: string): boolean {
  return Array.isArray(dismissed) && dismissed.includes(dismissKey(expertId, localDate));
}

/** 只保留今日 key，避免 localStorage 無限累積。 */
export function pruneDismissed(dismissed: string[] | undefined, localDate: string): string[] {
  return (dismissed || []).filter((k) => k.endsWith(`:${localDate}`));
}

/** 撰寫頁 banner 是否顯示：有名單、未被今日收起。 */
export function shouldShowBanner(params: {
  rows: ExpiringSubscriberRow[] | undefined;
  dismissed: string[] | undefined;
  expertId: string | null | undefined;
}): boolean {
  const rows = params.rows || [];
  if (!params.expertId || rows.length === 0) return false;
  return !isDismissed(params.dismissed, params.expertId, rows[0].local_date);
}

/** 驗證 HH:MM（24h）。 */
export function isValidReminderTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '').trim());
}

/** 驗證 IANA 時區（用 Intl 檢查，與 DB trigger 一致：無效即拒）。 */
export function isValidTimezone(value: string): boolean {
  const tz = String(value || '').trim();
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** DB `time` 欄位可能回 "18:00:00"，UI 顯示 HH:MM。 */
export function normalizeReminderTime(value: string | null | undefined): string {
  const v = String(value || '').trim();
  if (!v) return DEFAULT_JOURNAL_REMINDER_TIME;
  const m = v.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : DEFAULT_JOURNAL_REMINDER_TIME;
}
