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
 * 讓 STALE badge 觸發：在 fetch 完成之後（約 800ms）把 Date.now 前推 6 分鐘，
 * 並強制 ChipsSection 重新 render，這樣 hook 內 `stale` 會被重算為 true。
 */
function useForceStale(force: string | null, tick: number, setTick: (fn: (n: number) => number) => void) {
  useEffect(() => {
    if (force !== 'stale') return;
    const realNow = Date.now.bind(Date);
    let shifted = false;
    const originalNow = Date.now;
    // 首 800ms 保留真實時間，讓 fetchedAt 收下真值
    const t = window.setTimeout(() => {
      shifted = true;
      // 之後 Date.now 一律 +6 分鐘（TTL 是 5 分鐘）
      Date.now = () => realNow() + 6 * 60 * 1000;
      setTick((n) => n + 1);
    }, 800);
    return () => {
      window.clearTimeout(t);
      Date.now = originalNow;
    };
  }, [force]);
}

export default function ChipsSectionHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const code = params.get('code') || '2330';
  const force = params.get('force'); // offline | stale | null
  const freezeTime = params.get('freezeTime') === '1';

  // force=offline 必須在第一次 render 前生效
  if (force === 'offline') applyForceOffline();

  const [tick, setTick] = useState(0);
  useForceStale(force, tick, setTick);

  // freezeTime：把 Date.prototype.getTime / Date.now 都當成當前 mount 時間
  useEffect(() => {
    if (!freezeTime) return;
    const anchor = Date.now();
    const realNow = Date.now.bind(Date);
    Date.now = () => anchor;
    return () => {
      Date.now = realNow;
    };
  }, [freezeTime]);

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
