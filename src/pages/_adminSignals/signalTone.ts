/**
 * Tone tokens shared by SignalRow (table) & SignalListItem (card).
 * View model 只吐 toneKey，presenter 查表 → 避免 tailwind class 兩份漂移。
 */
export type SignalToneKey =
  | 'mentor'
  | 'success'
  | 'muted'
  | 'neutral'
  | 'warn'
  | 'info'
  | 'destructive';

export const SIGNAL_TONE_CLASS: Record<SignalToneKey, string> = {
  mentor: 'border border-mentor/40 bg-mentor/10 text-mentor',
  success: 'border border-success/40 bg-success/10 text-success',
  muted: 'border border-muted-foreground/40 bg-muted text-muted-foreground',
  neutral: 'border border-border bg-white text-foreground dark:bg-white dark:text-black',
  warn: 'border border-amber-400/40 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700',
  info: 'border border-blue-400/40 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700',
  destructive: 'border border-destructive/40 bg-destructive/10 text-destructive',
};

export function toneClass(key: SignalToneKey): string {
  return SIGNAL_TONE_CLASS[key];
}
