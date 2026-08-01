// 單一資料源：所有「資料新鮮度」顯示與判定（相對時間 / STALE）都走這裡。
//
// 背景（/skill:diagnosing-bugs 2026-08-01）：
//   抽屜的 `stale` 與「更新於 N 分鐘前」原本是 render 期直接算 Date.now()，
//   但沒有任何東西會在時間過去時觸發 re-render → 抽屜開著時新鮮度永遠凍在
//   打開那一刻。ChipsSection / HoldingsHero / HoldingCardFooter 又各自手刻一套
//   相對時間門檻，導致同一畫面出現互相矛盾的新鮮度。
//
// 規則：
//   - 相對時間文案一律用 `formatAge`。
//   - 需要隨時鐘更新的元件用 `useFreshness(ts, ttlMs)`，它內建 ticker。
import { useEffect, useMemo, useState } from 'react';

export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** 相對時間文案（繁中，統一門檻）。 */
export function formatAge(ageMs: number | null | undefined): string {
  if (ageMs == null || !Number.isFinite(ageMs)) return '—';
  const ms = Math.max(0, ageMs);
  if (ms < 45_000) return '剛剛更新';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

/** 絕對時鐘（YYYY/MM/DD HH:MM），給 tooltip 用。 */
export function formatClock(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相對時間跳動的節奏：一分鐘內每 5 秒，之後每 30 秒。 */
export function tickIntervalFor(ageMs: number): number {
  return ageMs < 60_000 ? 5_000 : 30_000;
}

export interface Freshness {
  ageMs: number | null;
  label: string;
  clock: string;
  stale: boolean;
}

/**
 * 隨時鐘推進的新鮮度。`ts` 為 null 時回傳空狀態且不啟動 ticker。
 */
export function useFreshness(ts: number | null | undefined, ttlMs: number = DEFAULT_TTL_MS): Freshness {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ts) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      if (cancelled) return;
      const current = Date.now();
      setNow(current);
      timer = setTimeout(schedule, tickIntervalFor(current - ts));
    };
    timer = setTimeout(schedule, tickIntervalFor(Date.now() - ts));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ts]);

  return useMemo(() => {
    if (!ts) return { ageMs: null, label: '—', clock: '', stale: false };
    const ageMs = Math.max(0, now - ts);
    return { ageMs, label: formatAge(ageMs), clock: formatClock(ts), stale: ageMs > ttlMs };
  }, [ts, now, ttlMs]);
}
