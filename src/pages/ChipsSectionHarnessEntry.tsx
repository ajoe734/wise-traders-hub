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
 * force=stale 時把分頁標成 hidden。
 * useTwChipsDetail 的 planAutoRefresh 在 !visible 時回 'paused' 不排程，
 * 否則 stale 一亮起就立刻自動重抓 → fetchedAt 被刷新 → badge 瞬間消失，
 * 快照永遠抓不到。stamp 探針同樣靠 visible 關掉，畫面才穩定。
 */
function applyHiddenTab() {
  try {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
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
 * 現在（固定時鐘注入）：
 *   - now=<epochMs|ISO> → 直接把 Date.now 釘死在指定時刻（不依賴機器時間），
 *     搭配 spec 的固定 fetched_at 就能讓「更新於 N 分鐘前」完全決定論、免 mask。
 *   - freezeTime=1     → 沒給 now 時凍結在 mount 當下的 anchor
 *   - force=stale      → staleAfter ms（預設 800）後把 offset 加上 staleShift（預設 6 分鐘）
 *   - force=stale 時把 freshness ticker 的長 setTimeout 壓成 120ms，讓 badge 準時亮
 *   - 位移套用後在 root 打上 data-stale-shifted="1"，spec 可等這個訊號而非睡秒數
 */
const STALE_SHIFT_DEFAULT_MS = 6 * 60 * 1000; // TTL 5 分鐘 + 1

function parseEpoch(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

interface ClockOpts {
  force: string | null;
  freezeTime: boolean;
  fixedNow: number | null;
  staleAfterMs: number;
  staleShiftMs: number;
}

function useHarnessClock(
  { force, freezeTime, fixedNow, staleAfterMs, staleShiftMs }: ClockOpts,
  setTick: (fn: (n: number) => number) => void,
  onShift: () => void,
) {
  useEffect(() => {
    const wantStale = force === 'stale';
    const pinned = fixedNow != null;
    if (!wantStale && !freezeTime && !pinned) return;

    const realNow = Date.now.bind(Date);
    const anchor = fixedNow ?? realNow();
    const frozen = pinned || freezeTime;
    let offset = 0;
    const base = () => (frozen ? anchor : realNow());
    const originalNow = Date.now;
    Date.now = () => base() + offset;

    const originalSetTimeout = window.setTimeout;
    if (wantStale) {
      window.setTimeout = ((fn: any, delay?: number, ...args: any[]) => {
        // useFreshness 的 ticker 只會用 5s / 30s 兩種間隔
        const d = delay === 5_000 || delay === 30_000 ? 120 : delay;
        return originalSetTimeout(fn, d as any, ...args);
      }) as typeof window.setTimeout;
    }

    let shiftTimer: number | undefined;
    if (wantStale) {
      // 首 staleAfterMs 保留原時刻，讓 fetchedAt 收下 anchor 附近的真值
      shiftTimer = originalSetTimeout(() => {
        offset = staleShiftMs;
        setTick((n) => n + 1);
        onShift();
      }, staleAfterMs);
    }

    return () => {
      if (shiftTimer !== undefined) window.clearTimeout(shiftTimer);
      window.setTimeout = originalSetTimeout;
      Date.now = originalNow;
    };
  }, [force, freezeTime, fixedNow, staleAfterMs, staleShiftMs]);
}


export default function ChipsSectionHarnessEntry() {
  if (!isPreviewEnv()) return null;
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const code = params.get('code') || '2330';
  const force = params.get('force'); // offline | stale | null
  const freezeTime = params.get('freezeTime') === '1';
  const fixedNow = parseEpoch(params.get('now'));
  const staleAfterMs = Number(params.get('staleAfter')) > 0 ? Number(params.get('staleAfter')) : 800;
  const staleShiftMs =
    Number(params.get('staleShift')) > 0 ? Number(params.get('staleShift')) : STALE_SHIFT_DEFAULT_MS;

  // force=offline 必須在第一次 render 前生效
  if (force === 'offline') applyForceOffline();
  if (force === 'stale') applyHiddenTab();


  const [tick, setTick] = useState(0);
  const [shifted, setShifted] = useState(false);
  useHarnessClock(
    { force, freezeTime, fixedNow, staleAfterMs, staleShiftMs },
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
