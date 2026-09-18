/**
 * 續訂提醒寄送狀態（純函式，無 IO）。
 *
 * 資料來源：`audit_logs`
 * - Email：action='subscription.renewal_email_sent'，detail.days_left
 * - LINE ：action='subscription.renewal_reminder_sent'，detail.days_left
 * target_id = member_subscriptions.id（一期訂閱）。
 *
 * UI 只讀這裡的摘要，不自己判斷「有沒有寄過」。
 */

export const RENEWAL_EMAIL_ACTION = 'subscription.renewal_email_sent';
export const RENEWAL_LINE_ACTION = 'subscription.renewal_reminder_sent';
export const RENEWAL_EMAIL_FAILED_ACTION = 'subscription.renewal_email_failed';
export const RENEWAL_REMINDER_ACTIONS = [
  RENEWAL_EMAIL_ACTION, RENEWAL_LINE_ACTION, RENEWAL_EMAIL_FAILED_ACTION,
] as const;

/** 與 edge function `email-push-renewal-reminder` 的 REMINDER_DAYS 對齊。 */
export const REMINDER_DAYS = [7, 3, 1, 0, -1] as const;

export type ReminderChannel = 'email' | 'line';

export interface ReminderLogRow {
  action: string;
  target_id: string | null;
  created_at: string;
  detail: unknown;
}

export interface ReminderEvent {
  channel: ReminderChannel;
  days_left: number | null;
  created_at: string;
}

export interface ReminderSummary {
  events: ReminderEvent[];      // 新到舊
  last?: ReminderEvent;
  channels: ReminderChannel[];  // 去重
}

const EMPTY: ReminderSummary = { events: [], channels: [] };

function daysLeftOf(detail: unknown): number | null {
  if (detail && typeof detail === 'object' && 'days_left' in (detail as Record<string, unknown>)) {
    const v = Number((detail as Record<string, unknown>).days_left);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** 依 subscription id 收斂成摘要。 */
export function buildReminderIndex(logs: ReminderLogRow[]): Record<string, ReminderSummary> {
  const out: Record<string, ReminderSummary> = {};
  for (const l of logs) {
    if (!l.target_id) continue;
    const channel: ReminderChannel | null =
      l.action === RENEWAL_EMAIL_ACTION ? 'email' : l.action === RENEWAL_LINE_ACTION ? 'line' : null;
    if (!channel) continue;
    const bucket = out[l.target_id] || (out[l.target_id] = { events: [], channels: [] });
    bucket.events.push({ channel, days_left: daysLeftOf(l.detail), created_at: l.created_at });
  }
  for (const s of Object.values(out)) {
    s.events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    s.last = s.events[0];
    s.channels = [...new Set(s.events.map((e) => e.channel))];
  }
  return out;
}

export function summaryFor(index: Record<string, ReminderSummary>, subscriptionId: string | null | undefined): ReminderSummary {
  return (subscriptionId && index[subscriptionId]) || EMPTY;
}

export type ReminderTone = 'sent' | 'pending' | 'none';

export interface ReminderBadge {
  tone: ReminderTone;
  label: string;
  title: string;
}

const CHANNEL_LABEL: Record<ReminderChannel, string> = { email: 'Email', line: 'LINE' };

function windowLabel(daysLeft: number | null): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return '過期後';
  if (daysLeft === 0) return '到期當日';
  return `T-${daysLeft}`;
}

/**
 * 表格「提醒」欄位：
 * - 已寄過 → 顯示最近一次通道與窗口
 * - 即將到期但未寄 → 待寄（排程每日 09:10 自動處理）
 * - 其他狀態（已流失／取消／還很久） → 無需提醒
 */
export function reminderBadge(params: {
  summary: ReminderSummary;
  status: 'live' | 'expiring' | 'churned' | 'canceled';
  remainingDays: number | null;
  formatDate: (iso: string) => string;
}): ReminderBadge {
  const { summary, status, remainingDays, formatDate } = params;
  if (summary.last) {
    const all = summary.events
      .map((e) => `${formatDate(e.created_at)} ${CHANNEL_LABEL[e.channel]} ${windowLabel(e.days_left)}`.trim())
      .join('\n');
    const w = windowLabel(summary.last.days_left);
    return {
      tone: 'sent',
      label: `已寄 ${formatDate(summary.last.created_at)}${w ? ` · ${w}` : ''}`,
      title: `提醒紀錄（新到舊）：\n${all}`,
    };
  }
  if (status === 'expiring' || (status === 'live' && remainingDays != null && remainingDays <= 7)) {
    return {
      tone: 'pending',
      label: '待寄',
      title: '排程每日 09:10（台北）自動寄出 T-7／T-3／T-1／到期日／過期後 24 小時提醒',
    };
  }
  return { tone: 'none', label: '—', title: '目前不在提醒窗口' };
}
