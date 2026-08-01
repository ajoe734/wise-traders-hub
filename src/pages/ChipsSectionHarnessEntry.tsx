// @ts-nocheck
/**
 * Preview-only E2E harness · ChipsSection
 *
 * URL: /e2e/chips-section?code=2330
 *   - code: 台股代碼；非台股（例：AAPL）用來測非渲染
 *   - force=offline: 進頁面前把 navigator.onLine 覆蓋為 false，觸發 OFFLINE badge
 *   - force=stale:  fetch 完成後把 Date.now 前推 TTL+1 分鐘，觸發 STALE badge
 *   - freezeTime=1: 把「更新於 X 分鐘前」的相對時間文字凍結到 fetchedAt 的當下
 *                   （讓視覺快照免 mask 也能穩定）
 *
 * 網路請求全部由 Playwright `page.route('**\/tw-chips-detail**')` 攔截
 * 這個 harness 只是把 ChipsSection 掛到頁面上，其他都交給 spec。
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { WB } from '@/pages/_freeCheckup/constants.jsx';

const ChipsSection = lazy(
  () => import('@/checkup/components/freecheckup/ChipsSection'),
);

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

/** 一次性把 navigator.onLine 覆寫為 false，讓 hook 直接走 offline 分支 */
function applyForceOffline() {
  try {
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      configurable: true,
    });
  } catch {}
}

/**
 * 統一的時間控制器（force=stale / freezeTime 共用同一個 Date.now 覆寫）。
 *
 * 舊版問題：force=stale 與 freezeTime 各自覆寫 Date.now，後者會把前者蓋掉；
 * 而且 `stale` 自從 freshness.ts 重構後改由 `useFreshness` 的 ticker 決定
 * （最短 5s 才跳一次），只把 Date.now 前推不會立刻 re-render，
 * STALE badge 在 5s timeout 內來不及亮。
 *
 * 現在：
 *   - freezeTime → now 凍結在 mount 當下的 anchor（相對時間文字穩定）
 *   - force=stale → 800ms 後把 offset 加上 TTL+1 分鐘
 *   - force=stale 時同時把「長 setTimeout」壓縮成 120ms，
 *     讓 useFreshness 的 ticker 立刻重算 → STALE badge 準時亮起
 */
function useHarnessClock(force: string | null, freezeTime: boolean, setTick: (fn: (n: number) => number) => void) {
  useEffect(() => {
    const wantStale = force === 'stale';
    if (!wantStale && !freezeTime) return;

    const realNow = Date.now.bind(Date);
    const anchor = realNow();
    let offset = 0;
    const base = () => (freezeTime ? anchor : realNow());
    const originalNow = Date.now;
    Date.now = () => base() + offset;

    // 壓縮 useFreshness 的 ticker，讓時間前推後立刻反映到畫面
    const originalSetTimeout = window.setTimeout;
    if (wantStale) {
      window.setTimeout = ((fn: any, delay?: number, ...args: any[]) => {
        const d = typeof delay === 'number' && delay >= 1_000 && delay <= 120_000 ? 120 : delay;
        return originalSetTimeout(fn, d as any, ...args);
      }) as typeof window.setTimeout;
    }

    let shiftTimer: number | undefined;
    if (wantStale) {
      // 首 800ms 保留真實時間，讓 fetchedAt 收下 anchor 附近的真值
      shiftTimer = originalSetTimeout(() => {
        offset = 6 * 60 * 1000; // TTL 5 分鐘 + 1
        setTick((n) => n + 1);
      }, 800);
    }

    return () => {
      if (shiftTimer !== undefined) window.clearTimeout(shiftTimer);
      window.setTimeout = originalSetTimeout;
      Date.now = originalNow;
    };
  }, [force, freezeTime]);
}


  return (
    <div
      data-testid="chips-harness-root"
      style={{
        background: WB?.bg || '#F5F3EF',
        color: WB?.ink || '#292520',
        padding: 20,
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: '"Source Serif 4", "Noto Serif TC", Georgia, serif',
      }}
    >
      <div data-testid="chips-harness-code" style={{ fontSize: 11, letterSpacing: '0.14em' }}>
        HARNESS · code={code}
        {force ? ` · force=${force}` : ''}
        {freezeTime ? ' · freezeTime' : ''}
        {tick > 0 ? ` · tick=${tick}` : ''}
      </div>
      <Suspense fallback={<div data-testid="chips-harness-loading">loading harness…</div>}>
        <ChipsSection WB={WB} stockCode={code} />
      </Suspense>
    </div>
  );
}
