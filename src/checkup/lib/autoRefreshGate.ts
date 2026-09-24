/**
 * autoRefreshGate —— 持倉報價自動刷新的純決策函式（FreeCheckup.runAutoRefresh 單一來源）。
 *
 * 規則：
 *   - minutes<=0（關閉）→ 永不自動刷新。
 *   - stale：距上次完成 >= interval − 寬限（min(15s, 20%)）；寬限用來吸收「請求耗時」，
 *     否則 timer 每隔一輪會被判未過期而跳過。
 *   - closePending（收盤待補）可繞過 stale，但受同 fingerprint 退避 1→2→5→15→30 分鐘約束。
 *   - 任何情況 55 秒內最多一次。
 */
import { nextCloseRetryDelay } from './closeAlignment';

export const AUTO_REFRESH_MIN_GAP_MS = 55 * 1000;

export interface CloseBackoffState { fp: string | null; attempts: number; nextAt: number }

export interface AutoRefreshInput {
  now: number;
  minutes: number;
  lastUpdateMs: number | null;
  lastRunAt: number;
  closePending: boolean;
  authorityDone: boolean;
  fingerprint: string;
  backoff: CloseBackoffState;
}

export type AutoRefreshDecision =
  | { run: false; why: 'off' | 'fresh' | 'authority-done' | 'backoff' | 'min-gap' }
  | { run: true; why: 'stale' | 'close-pending' };

export function staleGraceMs(intervalMs: number): number {
  return Math.min(15 * 1000, intervalMs * 0.2);
}

export function decideAutoRefresh(i: AutoRefreshInput): AutoRefreshDecision {
  if (!(i.minutes > 0)) return { run: false, why: 'off' };
  const intervalMs = i.minutes * 60 * 1000;
  const stale = i.lastUpdateMs == null || i.now - i.lastUpdateMs >= intervalMs - staleGraceMs(intervalMs);
  if (!stale && !i.closePending) return { run: false, why: 'fresh' };
  if (i.authorityDone) return { run: false, why: 'authority-done' };
  const bo = i.backoff;
  if (bo.fp !== i.fingerprint) { bo.fp = i.fingerprint; bo.attempts = 0; bo.nextAt = 0; }
  if (!stale && i.closePending && i.now < bo.nextAt) return { run: false, why: 'backoff' };
  if (i.now - (i.lastRunAt || 0) < AUTO_REFRESH_MIN_GAP_MS) return { run: false, why: 'min-gap' };
  return { run: true, why: stale ? 'stale' : 'close-pending' };
}

/** 請求結束後更新退避狀態。settledOk=收盤定版成功取得。 */
export function recordCloseAttempt(bo: CloseBackoffState, now: number, settledOk: boolean, closePending: boolean) {
  if (settledOk) { bo.attempts = 0; bo.nextAt = 0; return; }
  if (closePending) { bo.nextAt = now + nextCloseRetryDelay(bo.attempts); bo.attempts += 1; }
}
