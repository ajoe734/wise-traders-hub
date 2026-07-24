import * as React from 'react';

/**
 * 管理後台 SignalsTable 的 RWD 形態選擇：
 * - ≥ 1280px → 'table' （欄寬有兜底）
 * - 768–1279px → 'card' （涵蓋 809px 現場預覽 iframe 與筆電側欄開啟）
 * - < 768px → 'card-compact' （較緊 padding）
 *
 * SSR/首次渲染回 'card' 避免 CLS，並讓行動裝置優先取得可用畫面。
 * URL 加 `?legacyTable=1` 可強制 table 版做線上緊急退版開關。
 */
export type AdminSignalsLayout = 'table' | 'card' | 'card-compact';

const DESKTOP_MIN = 1280;
const CARD_MIN = 768;

function readLayout(): AdminSignalsLayout {
  if (typeof window === 'undefined') return 'card';
  try {
    const params = new URLSearchParams(window.location.search);
    // TODO(2026-08-31): 移除 legacyTable 退版開關，改版穩定兩週後統一。
    if (params.get('legacyTable') === '1') return 'table';
  } catch {
    // ignore
  }
  const w = window.innerWidth;
  if (w >= DESKTOP_MIN) return 'table';
  if (w >= CARD_MIN) return 'card';
  return 'card-compact';
}

export function useAdminSignalsLayout(): AdminSignalsLayout {
  const subscribe = React.useCallback((cb: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const desktop = window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`);
    const cardish = window.matchMedia(`(min-width: ${CARD_MIN}px)`);
    desktop.addEventListener('change', cb);
    cardish.addEventListener('change', cb);
    return () => {
      desktop.removeEventListener('change', cb);
      cardish.removeEventListener('change', cb);
    };
  }, []);
  return React.useSyncExternalStore(subscribe, readLayout, () => 'card');
}
