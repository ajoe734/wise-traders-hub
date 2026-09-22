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
/** 站內通知：不依賴外部寄信服務，是唯一保證會員看得到的通道。 */
export const RENEWAL_INAPP_ACTION = 'subscription.renewal_inapp_sent';
export const RENEWAL_INAPP_FAILED_ACTION = 'subscription.renewal_inapp_failed';
export const RENEWAL_REMINDER_ACTIONS = [
  RENEWAL_EMAIL_ACTION, RENEWAL_LINE_ACTION, RENEWAL_EMAIL_FAILED_ACTION,
  RENEWAL_INAPP_ACTION, RENEWAL_INAPP_FAILED_ACTION,
] as const;

/** 與 edge function `email-push-renewal-reminder` 的 REMINDER_DAYS 對齊。 */
export const REMINDER_DAYS = [7, 3, 1, 0, -1] as const;

export type ReminderChannel = 'email' | 'line' | 'inapp';

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
  failed?: boolean;
  error?: string;
}

export interface ReminderSummary {
  events: ReminderEvent[];      // 新到舊（僅成功）
  failures: ReminderEvent[];    // 新到舊（寄送失敗）
  last?: ReminderEvent;
  lastFailure?: ReminderEvent;
  channels: ReminderChannel[];  // 去重
}

const EMPTY: ReminderSummary = { events: [], failures: [], channels: [] };

function daysLeftOf(detail: unknown): number | null {
  if (detail && typeof detail === 'object' && 'days_left' in (detail as Record<string, unknown>)) {
    const v = Number((detail as Record<string, unknown>).days_left);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function errorOf(detail: unknown): string | undefined {
  if (detail && typeof detail === 'object' && 'error' in (detail as Record<string, unknown>)) {
    const v = (detail as Record<string, unknown>).error;
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

const byNewest = (a: ReminderEvent, b: ReminderEvent) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

/** 依 subscription id 收斂成摘要。 */
export function buildReminderIndex(logs: ReminderLogRow[]): Record<string, ReminderSummary> {
  const out: Record<string, ReminderSummary> = {};
  for (const l of logs) {
    if (!l.target_id) continue;
    const failed = l.action === RENEWAL_EMAIL_FAILED_ACTION || l.action === RENEWAL_INAPP_FAILED_ACTION;
    const channel: ReminderChannel | null =
      l.action === RENEWAL_EMAIL_ACTION || l.action === RENEWAL_EMAIL_FAILED_ACTION ? 'email'
        : l.action === RENEWAL_INAPP_ACTION || l.action === RENEWAL_INAPP_FAILED_ACTION ? 'inapp'
          : l.action === RENEWAL_LINE_ACTION ? 'line' : null;
    if (!channel) continue;
    const bucket = out[l.target_id] || (out[l.target_id] = { events: [], failures: [], channels: [] });
    const ev: ReminderEvent = {
      channel, days_left: daysLeftOf(l.detail), created_at: l.created_at,
      ...(failed ? { failed: true, error: errorOf(l.detail) } : {}),
    };
    if (failed) bucket.failures.push(ev);
    else bucket.events.push(ev);
  }
  for (const s of Object.values(out)) {
    s.events.sort(byNewest);
    s.failures.sort(byNewest);
    s.last = s.events[0];
    s.lastFailure = s.failures[0];
    s.channels = [...new Set(s.events.map((e) => e.channel))];
  }
  return out;
}

export function summaryFor(index: Record<string, ReminderSummary>, subscriptionId: string | null | undefined): ReminderSummary {
  return (subscriptionId && index[subscriptionId]) || EMPTY;
}

export type ReminderTone = 'sent' | 'pending' | 'failed' | 'none';

export interface ReminderBadge {
  tone: ReminderTone;
  label: string;
  title: string;
}

const CHANNEL_LABEL: Record<ReminderChannel, string> = { email: 'Email', line: 'LINE', inapp: '站內' };

function windowLabel(daysLeft: number | null): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return '過期後';
  if (daysLeft === 0) return '到期當日';
  return `T-${daysLeft}`;
}

/**
 * 表格「提醒」欄位：
 * - 同一波提醒只要有任一通道成功（站內／Email／LINE）→ 視為已通知，失敗通道寫在 tooltip
 * - 最近一次失敗且之後 24 小時內沒有任何成功 → 通知失敗
 * - 即將到期但完全沒送 → 待送（排程每日 09:10 自動處理）
 * - 其他狀態（已流失／取消／還很久） → 無需提醒
 */
const SAME_WAVE_MS = 24 * 60 * 60 * 1000;

export function reminderBadge(params: {
  summary: ReminderSummary;
  status: 'live' | 'expiring' | 'churned' | 'canceled';
  remainingDays: number | null;
  formatDate: (iso: string) => string;
}): ReminderBadge {
  const { summary, status, remainingDays, formatDate } = params;
  const fail = summary.lastFailure;
  const ok = summary.last;
  const okMs = ok ? new Date(ok.created_at).getTime() : -Infinity;
  const failMs = fail ? new Date(fail.created_at).getTime() : -Infinity;
  const failUnrescued = !!fail && failMs > okMs + SAME_WAVE_MS;
  if (failUnrescued) {
    const w = windowLabel(fail!.days_left);
    return {
      tone: 'failed',
      label: `通知失敗 ${formatDate(fail!.created_at)}${w ? ` · ${w}` : ''}`,
      title: `最近一次通知失敗：${formatDate(fail!.created_at)}（${CHANNEL_LABEL[fail!.channel]}）${fail!.error ? `\n${fail!.error}` : ''}`,
    };
  }
  if (ok) {
    const all = summary.events
      .map((e) => `${formatDate(e.created_at)} ${CHANNEL_LABEL[e.channel]} ${windowLabel(e.days_left)}`.trim())
      .join('\n');
    const failNote = summary.failures.length
      ? `\n失敗通道：\n${summary.failures
        .map((e) => `${formatDate(e.created_at)} ${CHANNEL_LABEL[e.channel]}${e.error ? ` — ${e.error}` : ''}`)
        .join('\n')}`
      : '';
    const w = windowLabel(ok.days_left);
    return {
      tone: 'sent',
      label: `已通知 ${formatDate(ok.created_at)} · ${CHANNEL_LABEL[ok.channel]}${w ? ` · ${w}` : ''}`,
      title: `提醒紀錄（新到舊）：\n${all}${failNote}`,
    };
  }
  if (status === 'expiring' || (status === 'live' && remainingDays != null && remainingDays <= 7)) {
    return {
      tone: 'pending',
      label: '待送',
      title: '排程每日 09:10（台北）自動送出站內通知／Email／LINE 的 T-7／T-3／T-1／到期日／過期後 24 小時提醒',
    };
  }
  return { tone: 'none', label: '—', title: '目前不在提醒窗口' };
}
