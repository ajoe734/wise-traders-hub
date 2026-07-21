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
