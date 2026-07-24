/**
 * LINE signal push helpers extracted from
 * supabase/functions/line-push-signal/index.ts.
 * Pure functions / injectable-fetch functions for unit testing;
 * the Deno function is drift-detected.
 */

import { getActionMeta } from '@/lib/signalAction';

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';


type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Send a LINE multicast message in batches of 500.
 * Mirrors sendToLine in line-push-signal/index.ts.
 * On batch failure (non-ok response): logs error and continues to the next batch.
 *
 * @param channelToken - LINE channel access token
 * @param targets      - list of LINE user IDs to push to
 * @param message      - message object (Flex or Text)
 * @param fetchFn      - injectable fetch (defaults to globalThis.fetch for production)
 * @returns total number of successfully pushed targets
 */
export async function sendToLine(
  channelToken: string,
  targets: string[],
  message: object,
  fetchFn: FetchLike,
): Promise<number> {
  let totalPushed = 0;
  for (let i = 0; i < targets.length; i += 500) {
    const batch = targets.slice(i, i + 500);
    const res = await fetchFn(LINE_MULTICAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelToken}`,
      },
      body: JSON.stringify({ to: batch, messages: [message] }),
    });
    if (res.ok) {
      totalPushed += batch.length;
    } else {
      const errBody = await res.text();
      console.error(`LINE multicast failed for batch ${i}:`, errBody);
    }
  }
  return totalPushed;
}

export interface SignalMessage {
  action: string;
  instrument: string;
  price_hint?: string | null;
  quantity?: number | string | null;
  quantity_unit?: string | null;
  teaching_topic?: string | null;
  overall_summary?: string | null;
  reason_summary?: string | null;
  reason_detail?: string | null;
  risk_notes?: string | null;
  learning_points?: string | null;
}

/**
 * Build a LINE Flex Message for signal push notifications.
 * Mirrors buildFlexMessage in line-push-signal/index.ts.
 *
 * @param signal - signal data object
 * @param type   - 'publish' (default) or 'takedown'
 */
export function buildFlexMessage(
  signal: SignalMessage,
  type: 'publish' | 'takedown' = 'publish',
): object {
  const label = getActionMeta(signal.action).label;

  if (type === 'takedown') {
    const bodyContents: object[] = [
      {
        type: 'text',
        text: '⚠️ 訊號已收回',
        weight: 'bold',
        size: 'lg',
        color: '#DC3545',
      },
      {
        type: 'text',
        text: `${label} ${signal.instrument}`,
        size: 'md',
        color: '#444444',
        margin: 'md',
        weight: 'bold',
      },
      {
        type: 'text',
        text: '此訊號已被分析師收回，不再有效。',
        size: 'xs',
        color: '#999999',
        margin: 'lg',
        wrap: true,
      },
    ];

    return {
      type: 'flex',
      altText: `⚠️ 訊號已收回：${label} ${signal.instrument}`,
      contents: {
        type: 'bubble',
        body: { type: 'box', layout: 'vertical', contents: bodyContents },
      },
    };
  }

  // publish message
  const isBullish = ['buy', 'add'].includes(signal.action);
  const color = isBullish ? '#00B900' : '#DC3545';

  // BUG-FIX: 移除 '張' 硬編 fallback — us_stock/期貨會誤顯示。
  const qtyLabel = signal.quantity
    ? `(${signal.quantity}${signal.quantity_unit || ''})`
    : '';

  const bodyContents: object[] = [
    {
      type: 'text',
      text: `${label} ${signal.instrument}`,
      weight: 'bold',
      size: 'xl',
      color,
    },
  ];

  if (signal.price_hint) {
    const qtyText = signal.quantity
      ? `(${signal.quantity}${signal.quantity_unit || ''})`
      : '';
    bodyContents.push({
      type: 'text',
      text: `參考價位：${signal.price_hint}${qtyText}`,
      size: 'sm',
      color: '#666666',
      margin: 'md',
    });
  }

  if (signal.teaching_topic) {
    bodyContents.push(
      { type: 'text', text: '📚 教學主題', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.teaching_topic, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    );
  }

  if (signal.overall_summary) {
    bodyContents.push(
      { type: 'text', text: '📝 整體摘要', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.overall_summary, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    );
  }

  if (signal.reason_summary) {
    bodyContents.push(
      { type: 'text', text: '❓ 為什麼這樣操作？', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.reason_summary, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    );
  }

  if (signal.reason_detail) {
    bodyContents.push(
      { type: 'text', text: '◉ 部位控管想法', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.reason_detail, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    );
  }

  if (signal.risk_notes) {
    bodyContents.push(
      { type: 'text', text: '⚠️ 風險提醒', size: 'sm', color: '#DC3545', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.risk_notes, size: 'xs', color: '#999999', margin: 'sm', wrap: true },
    );
  }

  if (signal.learning_points) {
    bodyContents.push(
      { type: 'text', text: '🎯 教學重點', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.learning_points, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    );
  }

  const footer = {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'button',
        action: {
          type: 'clipboard',
          label: '📋 一鍵複製',
          clipboardText: `【${label} ${signal.instrument}】`,
        },
        style: 'secondary',
        height: 'sm',
        color: '#F0F0F0',
      },
    ],
    spacing: 'sm',
    paddingAll: 'lg',
  };

  return {
    type: 'flex',
    altText: `${label} ${signal.instrument}${signal.price_hint ? ` @ ${signal.price_hint}` : ''}`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
      footer,
    },
  };
}
