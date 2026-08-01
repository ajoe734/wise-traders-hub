// @ts-nocheck
/**
 * Preview-only E2E harness · ChipsSection
 *
 * URL: /e2e/chips-section?code=2330
 *   - code=2330        台股代碼；非台股（例：AAPL）用來測非渲染
 *   - force=offline    進頁面前把 navigator.onLine 覆蓋為 false，觸發 OFFLINE badge
 *   - force=stale      staleAfter 之後把 Date.now 前推 staleShift，觸發 STALE badge
 *   - force=fresh      強制新鮮：時鐘釘死、不位移，stale 永遠不亮（權重高於 stale）
 *   - freezeTime=1     凍結 Date.now 在 mount 當下（相對時間文字穩定）
 *   - now=<ms|ISO>     固定時鐘注入：把 Date.now 釘在指定時刻（決定論，優於 freezeTime）
 *   - staleAfter=<ms>  位移延遲，預設 800
 *   - staleShift=<ms>  位移量，預設 6 分鐘（TTL 5 分 + 1）
 *   force 可用逗號組合（例 force=stale,fresh → fresh 勝出）。
 *
 * 時鐘覆寫規則與權重的**單一實作**在 `@/checkup/lib/harnessClock`
 * （含單元測試 `__tests__/harnessClock.test.ts`）；規格文件見
 * `docs/qa/harness-clock-injection.md`。此檔只負責把參數接上去 + 打訊號：
 *   - data-stale-shifted="1"：位移已套用（spec 等這個，不要睡秒數）
 *   - data-fixed-now="1"：時鐘已被釘死
 *
 * 網路請求全部由 Playwright `page.route('**\/tw-chips-detail**')` 攔截
 * 這個 harness 只是把 ChipsSection 掛到頁面上，其他都交給 spec。
 *
 * SECURITY: preview-only；prod 回傳 null。
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { WB } from '@/pages/_freeCheckup/constants.jsx';
import {
  installHarnessClock,
  parseEpoch,
  resolveMode,
  STALE_AFTER_DEFAULT_MS,
  STALE_SHIFT_DEFAULT_MS,
} from '@/checkup/lib/harnessClock';


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
 * 分頁可見性覆寫（可切換）。
 *
 * useTwChipsDetail 的 planAutoRefresh 在 !visible 時回 'paused' 不排程；
 * visible 時 stale 一亮就會自動重抓。STALE 快照預設用 hidden 保護，
 * 但視覺回歸矩陣要能同時驗證 visible（自動重抓不得吃掉 badge），
 * 所以這裡把可見性做成可讀可寫、可即時切換的覆寫。
 *
 * spec 用 `window.__harnessSetVisibility('visible'|'hidden')` 切換，
 * 切換會 dispatch `visibilitychange`，hook 的 listener 才會跟上。
 */
let visibilityOverride: 'hidden' | 'visible' | null = null;
function installVisibilityOverride(initial: 'hidden' | 'visible') {
  visibilityOverride = initial;
  try {
    if (!(window as any).__harnessVisibilityInstalled) {
      Object.defineProperty(document, 'visibilityState', {
        get: () => visibilityOverride ?? 'visible',
        configurable: true,
      });
      Object.defineProperty(document, 'hidden', {
        get: () => (visibilityOverride ?? 'visible') === 'hidden',
        configurable: true,
      });
      (window as any).__harnessVisibilityInstalled = true;
      (window as any).__harnessSetVisibility = (v: 'hidden' | 'visible') => {
        visibilityOverride = v;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    }
  } catch {}
}


/**
 * 時間控制器：規則與權重全部委派給 `@/checkup/lib/harnessClock`。
 *
 * 歷史坑（別再手刻）：force=stale 與 freezeTime 曾各自覆寫 Date.now 互踩，
 * 後註冊者把前者蓋掉；且 `stale` 自 freshness.ts 重構後由 `useFreshness`
 * 的 ticker 決定（最短 5s 才跳），只前推 Date.now 不會立刻 re-render，
 * badge 在測試窗內來不及亮。installHarnessClock 把 base / offset / ticker
 * 壓縮三件事收斂成單一實作。
 */
function useHarnessClock(
  opts: {
    mode: 'stale' | 'fresh' | null;
    freezeTime: boolean;
    fixedNow: number | null;
    staleAfterMs: number;
    staleShiftMs: number;
  },
  setTick: (fn: (n: number) => number) => void,
  onShift: () => void,
) {
  const { mode, freezeTime, fixedNow, staleAfterMs, staleShiftMs } = opts;
  useEffect(() => {
    const clock = installHarnessClock({
      mode,
      fixedNow,
      freeze: freezeTime,
      staleAfterMs,
      staleShiftMs,
      onShift: () => {
        setTick((n) => n + 1);
        onShift();
      },
    });
    return () => clock.uninstall();
  }, [mode, freezeTime, fixedNow, staleAfterMs, staleShiftMs]);
}


export default function ChipsSectionHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const code = params.get('code') || '2330';
  const force = params.get('force'); // offline | stale | fresh（可逗號組合）| null
  const mode = resolveMode(force); // fresh > stale
  const freezeTime = params.get('freezeTime') === '1';
  const fixedNow = parseEpoch(params.get('now'));
  const staleAfterMs =
    Number(params.get('staleAfter')) > 0 ? Number(params.get('staleAfter')) : STALE_AFTER_DEFAULT_MS;
  const staleShiftMs =
    Number(params.get('staleShift')) > 0 ? Number(params.get('staleShift')) : STALE_SHIFT_DEFAULT_MS;

  // force=offline 必須在第一次 render 前生效
  if (force?.includes('offline')) applyForceOffline();
  // 只有 stale 需要凍住自動重抓；fresh 讓頁面照常可見
  if (mode === 'stale') applyHiddenTab();


  const [tick, setTick] = useState(0);
  const [shifted, setShifted] = useState(false);
  useHarnessClock(
    { mode, freezeTime, fixedNow, staleAfterMs, staleShiftMs },
    setTick,
    () => setShifted(true),
  );



  return (
    <div
      data-testid="chips-harness-root"
      data-stale-shifted={shifted ? '1' : '0'}
      data-fixed-now={fixedNow != null ? '1' : '0'}
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
