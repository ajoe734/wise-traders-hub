/**
 * Deno 鏡像：訊號 action 標籤的單一資料源。
 *
 * 與 `src/lib/signalAction.ts` 的 SIGNAL_ACTION_META label 必須逐字一致，
 * 由 `src/test/unit/signalActionLabel.test.ts` 的 parity 測試與
 * `scripts/audit-signal-action-labels.mjs` 的 CI 稽核共同守門。
 *
 * 禁止在任何 edge function 內再宣告 `{ buy: '買進', ... }` 這種地圖。
 * 未知 action 一律回傳原字串（或 '未知'），永不 fallback 成 買進。
 */

export type SignalActionKey =
  | 'buy'
  | 'sell'
  | 'add'
  | 'trim'
  | 'exit'
  | 'hold'
  | 'teaching';

export const SIGNAL_ACTION_LABELS: Record<SignalActionKey, string> = {
  buy: '買進',
  sell: '賣出',
  add: '加碼',
  trim: '減碼',
  exit: '平損',
  hold: '觀察',
  teaching: '教學',
};

export const UNKNOWN_ACTION_LABEL = '未知';

/**
 * 取得 action 中文標籤。
 * - 已知 action → 對應標籤
 * - 未知非空字串 → 原字串（讓維運看得到實際值）
 * - null / undefined / 空字串 → '未知'
 */
export function getActionLabel(action: string | null | undefined): string {
  if (!action) return UNKNOWN_ACTION_LABEL;
  return SIGNAL_ACTION_LABELS[action as SignalActionKey] ?? action;
}

export function isTeachingSignal(
  signal: { action?: string | null } | null | undefined,
): boolean {
  return signal?.action === 'teaching';
}
