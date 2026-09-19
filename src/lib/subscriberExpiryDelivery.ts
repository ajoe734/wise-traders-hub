/**
 * 老師端「到期通知送達狀態」（純函式，無 IO）。
 *
 * 資料來源：`subscriber_expiry_reminders`
 * - payload：該批次涵蓋的訂閱（含 subscription_id）
 * - channels：{ inapp|email|line: { state: 'sent'|'failed'|'skipped', at, reason?, error? } }
 * - reminder_type：subscriber_expiry_7d（0–7 天內）／subscriber_expiry_churn_24h（過期 24 小時）
 *
 * 管理頁只讀這裡的摘要，不自己判斷「老師有沒有被通知到」。
 */

export const EXPIRY_CHANNELS = ['inapp', 'email', 'line'] as const;
export type DeliveryChannel = (typeof EXPIRY_CHANNELS)[number];
export type DeliveryState = 'sent' | 'failed' | 'skipped';

export const CHANNEL_LABEL: Record<DeliveryChannel, string> = {
  inapp: '站內',
  email: 'Email',
  line: 'LINE',
};

export interface ExpiryReminderLedgerRow {
  expert_id: string;
  local_date: string;
  reminder_type: string | null;
  payload: unknown;
  channels: unknown;
  created_at: string;
}

export interface DeliveryEvent {
  channel: DeliveryChannel;
  state: DeliveryState;
  at: string;
  reason?: string;
  error?: string;
  reminder_type: string;
  local_date: string;
}

export interface DeliverySummary {
  events: DeliveryEvent[]; // 新到舊
  sent: DeliveryEvent[];
  failed: DeliveryEvent[];
  last?: DeliveryEvent;
}

const EMPTY: DeliverySummary = { events: [], sent: [], failed: [] };

function subscriptionIdsOf(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((i) => (i && typeof i === 'object' ? (i as Record<string, unknown>).subscription_id : null))
    .filter((v): v is string => typeof v === 'string');
}

function eventsOf(row: ExpiryReminderLedgerRow): DeliveryEvent[] {
  const ch = row.channels;
  if (!ch || typeof ch !== 'object') return [];
  const out: DeliveryEvent[] = [];
  for (const name of EXPIRY_CHANNELS) {
    const v = (ch as Record<string, unknown>)[name];
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const state = o.state;
    if (state !== 'sent' && state !== 'failed' && state !== 'skipped') continue;
    out.push({
      channel: name,
      state,
      at: typeof o.at === 'string' ? o.at : row.created_at,
      ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
      ...(typeof o.error === 'string' ? { error: o.error } : {}),
      reminder_type: row.reminder_type || 'subscriber_expiry_7d',
      local_date: row.local_date,
    });
  }
  return out;
}

const byNewest = (a: DeliveryEvent, b: DeliveryEvent) =>
  new Date(b.at).getTime() - new Date(a.at).getTime();

/** 依 subscription id 收斂：一個批次涵蓋的每一筆訂閱都掛上同一組通道結果。 */
export function buildDeliveryIndex(rows: ExpiryReminderLedgerRow[]): Record<string, DeliverySummary> {
  const out: Record<string, DeliverySummary> = {};
  for (const row of rows || []) {
    const events = eventsOf(row);
    if (events.length === 0) continue;
    for (const sid of subscriptionIdsOf(row.payload)) {
      const bucket = out[sid] || (out[sid] = { events: [], sent: [], failed: [] });
      bucket.events.push(...events);
    }
  }
  for (const s of Object.values(out)) {
    s.events.sort(byNewest);
    s.sent = s.events.filter((e) => e.state === 'sent');
    s.failed = s.events.filter((e) => e.state === 'failed');
    s.last = s.events[0];
  }
  return out;
}

export function deliveryFor(
  index: Record<string, DeliverySummary>,
  subscriptionId: string | null | undefined,
): DeliverySummary {
  return (subscriptionId && index[subscriptionId]) || EMPTY;
}

export type DeliveryTone = 'sent' | 'partial' | 'failed' | 'pending' | 'none';

export interface DeliveryBadge {
  tone: DeliveryTone;
  label: string;
  title: string;
}

const REASON_LABEL: Record<string, string> = {
  no_teacher_email: '老師未設定 Email',
  email_not_configured: '寄信服務未設定',
  no_line_binding: '老師未綁定 LINE',
};

function latestByChannel(summary: DeliverySummary): Partial<Record<DeliveryChannel, DeliveryEvent>> {
  const map: Partial<Record<DeliveryChannel, DeliveryEvent>> = {};
  for (const e of summary.events) if (!map[e.channel]) map[e.channel] = e; // events 已新到舊
  return map;
}

/**
 * 表格「通知老師」欄位：
 * - 最近一次有通道失敗 → 失敗（要處理寄信／LINE 設定）
 * - 有通道送達 → 列出送達通道與日期；若同時有跳過的通道標為部分送達
 * - 在提醒窗口但還沒送 → 待送（排程於老師提醒時間自動處理）
 * - 其他 → 無需通知
 */
export function deliveryBadge(params: {
  summary: DeliverySummary;
  status: 'live' | 'expiring' | 'churned' | 'canceled';
  remainingDays: number | null;
  formatDate: (iso: string) => string;
}): DeliveryBadge {
  const { summary, status, remainingDays, formatDate } = params;
  const latest = latestByChannel(summary);
  const detail = summary.events
    .map((e) => {
      const tag = e.state === 'sent' ? '已送' : e.state === 'failed' ? '失敗' : '略過';
      const extra = e.state === 'failed' ? (e.error || '') : REASON_LABEL[e.reason || ''] || '';
      return `${formatDate(e.at)} ${CHANNEL_LABEL[e.channel]} ${tag}${extra ? ` · ${extra}` : ''}`;
    })
    .join('\n');

  const failed = Object.values(latest).filter((e) => e!.state === 'failed') as DeliveryEvent[];
  const sent = Object.values(latest).filter((e) => e!.state === 'sent') as DeliveryEvent[];

  if (failed.length > 0) {
    return {
      tone: 'failed',
      label: `${failed.map((e) => CHANNEL_LABEL[e.channel]).join('·')} 失敗`,
      title: `通知送達紀錄（新到舊）：\n${detail}`,
    };
  }
  if (sent.length > 0) {
    const skipped = Object.values(latest).filter((e) => e!.state === 'skipped') as DeliveryEvent[];
    return {
      tone: skipped.length > 0 ? 'partial' : 'sent',
      label: `${sent.map((e) => CHANNEL_LABEL[e.channel]).join('·')} ${formatDate(sent[0].at)}`,
      title: `通知送達紀錄（新到舊）：\n${detail}`,
    };
  }
  if (status === 'churned' || status === 'expiring' || (status === 'live' && remainingDays != null && remainingDays <= 7)) {
    return {
      tone: 'pending',
      label: '待送',
      title: '排程於老師設定的提醒時間自動送出（站內＋Email＋LINE）',
    };
  }
  return { tone: 'none', label: '—', title: '目前不在通知窗口' };
}
