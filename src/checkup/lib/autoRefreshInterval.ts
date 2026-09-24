// Holdings auto-refresh interval preference (2026-07-21)
// Stored in localStorage; shared between FreeCheckup polling loop and HoldingsHero UI.
// Values are minutes; `0` means "off / manual only".
import { useEffect, useState, useCallback } from 'react';

const KEY = 'fc.holdings.autoRefreshMinutes';
const EVENT = 'fc:holdings-auto-refresh-changed';
const DEFAULT_MINUTES = 5;

export const AUTO_REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0,  label: '關閉自動' },
  { value: 1,  label: '每 1 分鐘' },
  { value: 3,  label: '每 3 分鐘' },
  { value: 5,  label: '每 5 分鐘（預設）' },
  { value: 10, label: '每 10 分鐘' },
  { value: 30, label: '每 30 分鐘' },
];

const ALLOWED = new Set(AUTO_REFRESH_OPTIONS.map(o => o.value));

export function getAutoRefreshMinutes(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return DEFAULT_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n) || !ALLOWED.has(n)) return DEFAULT_MINUTES;
    return n;
  } catch {
    return DEFAULT_MINUTES;
  }
}

export function setAutoRefreshMinutes(minutes: number) {
  const value = ALLOWED.has(minutes) ? minutes : DEFAULT_MINUTES;
  try {
    localStorage.setItem(KEY, String(value));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  } catch {}
}

export function useAutoRefreshMinutes(): [number, (v: number) => void] {
  const [value, setValue] = useState<number>(() => getAutoRefreshMinutes());
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === 'number') setValue(detail);
      else setValue(getAutoRefreshMinutes());
    };
    const storage = (e: StorageEvent) => {
      if (e.key === KEY) setValue(getAutoRefreshMinutes());
    };
    window.addEventListener(EVENT, handler as EventListener);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(EVENT, handler as EventListener);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const update = useCallback((v: number) => setAutoRefreshMinutes(v), []);
  return [value, update];
}

// ── 下次自動刷新時間（與 FreeCheckup 的 setTimeout 同一計時來源）──
const NEXT_EVENT = 'fc:holdings-next-auto-refresh';
let nextAt: number | null = null;

export function setNextAutoRefreshAt(ts: number | null) {
  nextAt = ts;
  try { window.dispatchEvent(new CustomEvent(NEXT_EVENT, { detail: ts })); } catch {}
}

export function getNextAutoRefreshAt(): number | null {
  return nextAt;
}

export function useNextAutoRefreshAt(): number | null {
  const [v, setV] = useState<number | null>(() => nextAt);
  useEffect(() => {
    const h = () => setV(nextAt);
    window.addEventListener(NEXT_EVENT, h);
    h();
    return () => window.removeEventListener(NEXT_EVENT, h);
  }, []);
  return v;
}

/**
 * 週期自動刷新迴圈（FreeCheckup 唯一計時來源）。
 * 每次排程都用同一個 `Date.now() + intervalMs` 同時設定 setTimeout 與「下次刷新」顯示，
 * 所以 Hero 的時間與實際觸發時間不會漂移。分頁隱藏時該輪不發請求，但照常排下一輪。
 */
export function startAutoRefreshLoop(opts: {
  getMinutes: () => number;
  run: () => Promise<unknown> | unknown;
  isHidden?: () => boolean;
}): () => void {
  let disposed = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const isHidden = opts.isHidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const schedule = () => {
    if (disposed) return;
    const minutes = opts.getMinutes();
    if (!(minutes > 0)) { setNextAutoRefreshAt(null); return; }
    const intervalMs = minutes * 60 * 1000;
    setNextAutoRefreshAt(Date.now() + intervalMs);
    timerId = setTimeout(async () => {
      timerId = null;
      if (disposed) return;
      try { if (!isHidden()) await opts.run(); } catch { /* 單輪失敗不中斷迴圈 */ }
      schedule();
    }, intervalMs);
  };
  const onChange = () => {
    if (timerId) { clearTimeout(timerId); timerId = null; }
    schedule();
  };
  schedule();
  window.addEventListener(EVENT, onChange);
  return () => {
    disposed = true;
    if (timerId) clearTimeout(timerId);
    setNextAutoRefreshAt(null);
    window.removeEventListener(EVENT, onChange);
  };
}
