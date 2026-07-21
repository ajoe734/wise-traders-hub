// Persist holdings "last price update" timestamp per user across reloads.
// 2026-07-21: 避免使用者重新整理後看到「尚未同步報價」而誤觸重刷。
const PREFIX = 'fc.holdings.lastUpdate.';

function keyFor(uid?: string | null): string {
  return PREFIX + (uid || 'guest');
}

export function readLastUpdate(uid?: string | null): Date | null {
  try {
    const raw = localStorage.getItem(keyFor(uid));
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    // 忽略明顯超過 7 天的過期快取，避免顯示誤導性「N 天前」
    if (Date.now() - n > 7 * 24 * 60 * 60 * 1000) return null;
    return new Date(n);
  } catch {
    return null;
  }
}

export function writeLastUpdate(uid: string | null | undefined, date: Date | null) {
  try {
    const k = keyFor(uid);
    if (!date) {
      localStorage.removeItem(k);
      return;
    }
    localStorage.setItem(k, String(date.getTime()));
  } catch {}
}
