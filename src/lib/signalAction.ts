/**
 * Single source of truth for signal `action` labels & styling.
 *
 * Any UI that renders a badge / label from `signal.action` MUST use
 * `getActionMeta()` or `SIGNAL_ACTION_META`. Never fall back to `.buy` —
 * unknown actions render as a neutral "未知" badge, never as 買進.
 *
 * A CI audit (scripts/audit-signal-action-labels.mjs) forbids duplicate
 * action-label maps and `|| actionLabels.buy` patterns elsewhere.
 */

export type SignalActionKey =
  | 'buy'
  | 'sell'
  | 'add'
  | 'trim'
  | 'exit'
  | 'hold'
  | 'teaching';

export interface SignalActionMeta {
  label: string;
  className: string;
}

export const SIGNAL_ACTION_META: Record<SignalActionKey, SignalActionMeta> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
  add: { label: '加碼', className: 'bg-blue-500 text-blue-50 border-blue-500' },
  trim: { label: '減碼', className: 'bg-amber-500 text-amber-50 border-amber-500' },
  exit: { label: '平損', className: 'bg-slate-500 text-slate-50 border-slate-500' },
  hold: { label: '觀察', className: 'bg-muted text-muted-foreground border-border' },
  teaching: { label: '教學', className: 'bg-mentor/10 text-mentor border-mentor/30' },
};

const UNKNOWN_META: SignalActionMeta = {
  label: '未知',
  className: 'bg-muted text-muted-foreground border-border',
};

/**
 * Look up meta for a signal action. Unknown / null / undefined actions
 * return a neutral "未知" badge — NEVER silently map to 買進.
 */
export function getActionMeta(action: string | null | undefined): SignalActionMeta {
  if (!action) return UNKNOWN_META;
  const meta = SIGNAL_ACTION_META[action as SignalActionKey];
  if (meta) return meta;
  // Preserve the raw action text so operators can still see what came in.
  return { ...UNKNOWN_META, label: action };
}

export function isTeachingSignal(signal: { action?: string | null } | null | undefined): boolean {
  return signal?.action === 'teaching';
}

/**
 * Instrument text to show in list/summary rows.
 * Teaching signals often have an empty instrument — show a stable label instead
 * of a blank cell.
 */
export function getSignalDisplayInstrument(
  signal: { action?: string | null; instrument?: string | null } | null | undefined,
): string {
  const raw = (signal?.instrument ?? '').trim();
  if (raw) return raw;
  if (isTeachingSignal(signal)) return '純教學週記';
  return '—';
}
