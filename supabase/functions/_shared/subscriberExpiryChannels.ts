// 訂閱者到期 → 老師端提醒的「文案單一資料源」。
// 三個通道（站內／Email／LINE）共用同一份名單與同一組措辭，避免各通道各寫一套。
// 純函式、無 IO：Deno 測試可直接驗證。

export type ReminderKind = 'subscriber_expiry_7d' | 'subscriber_expiry_churn_24h';

export type ExpiryItem = {
  display_name: string;
  plan_name: string | null;
  expires_on: string; // YYYY/MM/DD（老師時區）
  days_left: number;
};

export type ChannelName = 'inapp' | 'email' | 'line';
export type ChannelState = 'sent' | 'failed' | 'skipped';
export type ChannelResult = { state: ChannelState; at: string; reason?: string; error?: string };
export type ChannelMap = Partial<Record<ChannelName, ChannelResult>>;

export function isChurnKind(kind: ReminderKind): boolean {
  return kind === 'subscriber_expiry_churn_24h';
}

/** 單一筆的時間描述（與前台 daysLeftLabel 對齊）。 */
export function whenLabel(daysLeft: number): string {
  if (daysLeft < 0) return '已過期';
  if (daysLeft === 0) return '今日到期';
  if (daysLeft === 1) return '明日到期';
  return `剩 ${daysLeft} 天`;
}

export function headline(kind: ReminderKind, count: number): string {
  return isChurnKind(kind)
    ? `${count} 位訂閱者昨日到期未續訂`
    : `${count} 位訂閱者將於 7 日內到期`;
}

export function advice(kind: ReminderKind): string {
  return isChurnKind(kind)
    ? '過期 24 小時內回購可保留歷史資料，建議今天主動聯繫一次。'
    : '建議在今天的週記中多一句關懷，提醒他們續訂。';
}

export function itemLine(i: ExpiryItem): string {
  return `${i.display_name}（${i.plan_name || '訂閱方案'}・${i.expires_on}・${whenLabel(i.days_left)}）`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 老師 Email：主旨、HTML、純文字備援。不含訂閱者 email／LINE ID。 */
export function buildTeacherEmail(params: {
  kind: ReminderKind;
  expertName: string | null;
  items: ExpiryItem[];
  actionUrl: string;
}): { subject: string; html: string; text: string } {
  const { kind, items, actionUrl } = params;
  const count = items.length;
  const title = headline(kind, count);
  const subject = `${isChurnKind(kind) ? '🔔' : '⏰'} ${title}`;
  const rows = items.map((i) => `
      <tr>
        <td style="padding:8px 0;color:#292520;font-weight:700;">${escapeHtml(i.display_name)}</td>
        <td style="padding:8px 0;color:#555;">${escapeHtml(i.plan_name || '訂閱方案')}</td>
        <td style="padding:8px 0;text-align:right;color:#292520;">${escapeHtml(i.expires_on)}</td>
        <td style="padding:8px 0;text-align:right;color:${i.days_left <= 0 ? '#C0392B' : '#292520'};">${whenLabel(i.days_left)}</td>
      </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F5F3EF;padding:40px 0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;color:#292520;margin:0 0 8px;font-weight:700;">${escapeHtml(title)}</h1>
    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 16px;">${escapeHtml(advice(kind))}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
    <p style="text-align:center;margin:28px 0 8px;">
      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#EC662D;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">前往撰寫週記</a>
    </p>
    <p style="font-size:12px;color:#999;line-height:1.6;margin:18px 0 0;">此信由系統於您設定的提醒時間自動寄出，名單以續訂狀態即時計算。</p>
  </div>
</body></html>`;

  const text = [title, advice(kind), ...items.map(itemLine), actionUrl].join('\n');
  return { subject, html, text };
}

/** 老師 LINE：純文字訊息（不含訂閱者聯絡方式）。 */
export function buildTeacherLineText(params: {
  kind: ReminderKind;
  items: ExpiryItem[];
  actionUrl: string;
}): string {
  const { kind, items, actionUrl } = params;
  const head = headline(kind, items.length);
  const lines = items.slice(0, 10).map((i) => `・${itemLine(i)}`);
  const more = items.length > 10 ? `…等 ${items.length} 位` : '';
  return [head, ...lines, more, advice(kind), actionUrl].filter(Boolean).join('\n');
}

/** 通道結果 → ledger channels jsonb。 */
export function mergeChannels(base: ChannelMap, next: ChannelMap): ChannelMap {
  return { ...base, ...next };
}

/** 是否所有通道都失敗（站內也失敗）→ 釋放 ledger 讓下次重試。 */
export function allFailed(channels: ChannelMap): boolean {
  const states = Object.values(channels).map((c) => c?.state);
  return states.length > 0 && states.every((s) => s === 'failed');
}

export function hasFailure(channels: ChannelMap): boolean {
  return Object.values(channels).some((c) => c?.state === 'failed');
}
