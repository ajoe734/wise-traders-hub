/**
 * Backward-compat re-export. New code should import from `@/lib/signalAction`
 * directly and use `getActionMeta(action)` instead of `actionLabels[action]`.
 *
 * NEVER add a `|| actionLabels.buy` fallback — unknown actions must render as
 * "未知", not 買進. See `src/lib/signalAction.ts` and
 * `scripts/audit-signal-action-labels.mjs`.
 */
export { SIGNAL_ACTION_META as actionLabels } from '@/lib/signalAction';
export { getActionMeta, isTeachingSignal, getSignalDisplayInstrument } from '@/lib/signalAction';

export const stripDotPrefix = (text: string) =>
  text.replace(/^[•·．‧●○◆■□▪▫※☆★→➤➜▸▹►▻‣⁃–—\-]\s*/gm, '');
