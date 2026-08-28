/**
 * expectedTradeDateStore — TW「目前 expected trade date」的 module-level 單一 scheduler。
 *
 * 為什麼是 module 級單例（而不是放在 hook 裡）：同頁若有多個 consumer，
 * 放在 hook 內就會變成每個 instance 一顆 timer + 一個 visibility listener。
 * 這裡保證：全域最多 1 顆 timer、1 個 visibility listener，refCount 0↔1 才 start/stop。
 *
 * 契約：
 *   - snapshot 是穩定 reference：值沒真的變就不換 reference、不 emit
 *     （反覆 visibility + loader reject 不會觸發任何 effect / request）。
 *   - 休市日表未載入 → `calendarReady=false`、`expectedTradeDate=''`（fail-closed，
 *     不得在休市日偽造新的 completed date）；恢復點是「回前景」，不 polling。
 *   - timer 是 one-shot：唯一 owner 是 `recomputeAndSchedule()`；睡醒／背景節流後
 *     一律以「現在」重算，先 cancel 舊 timer 再排下一顆。
 */
import { nowDate, nowMs } from './nowProvider';
import { holidaysLoaded, latestCompletedTradeDate } from './marketCalendar';
import { loadMarketHolidays } from './marketHolidaysLoader';
import { nextExpectedChangeAt } from './tradeDateBoundary';

export interface ExpectedSnapshot {
  /** YYYY-MM-DD；calendar 未就緒時為 '' */
  expectedTradeDate: string;
  /** 這份 snapshot 的計算時間（不參與相等判定） */
  computedAtMs: number;
  calendarReady: boolean;
}

const EMPTY: ExpectedSnapshot = { expectedTradeDate: '', computedAtMs: 0, calendarReady: false };

let snapshot: ExpectedSnapshot = EMPTY;
const listeners = new Set<() => void>();
let refCount = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let visibilityBound = false;

function emit() {
  listeners.forEach((l) => { try { l(); } catch { /* consumer 自理 */ } });
}

/** 只有值真的改變才換 reference（computedAtMs 不參與比較）。 */
function setSnapshot(next: ExpectedSnapshot) {
  if (snapshot.expectedTradeDate === next.expectedTradeDate
    && snapshot.calendarReady === next.calendarReady) return;
  snapshot = next;
  emit();
}

function clearTimer() {
  if (timer != null) { clearTimeout(timer); timer = null; }
}

function ensureCalendar(gen: number) {
  void loadMarketHolidays().then((ok) => {
    if (!ok) return;
    if (gen !== generation) return;
    recomputeAndSchedule();
  }).catch(() => { /* fail-closed：等下一次回前景 */ });
}

/** 唯一的 schedule owner。任何觸發點（start / timer / visibility）都只能呼叫這支。 */
function recomputeAndSchedule() {
  const gen = ++generation;
  clearTimer();

  if (!holidaysLoaded('TW')) {
    setSnapshot({ expectedTradeDate: '', computedAtMs: nowMs(), calendarReady: false });
    ensureCalendar(gen);
    return; // fail-closed：calendar 未就緒不排 timer、不推進 expected
  }

  const now = nowDate();
  setSnapshot({
    expectedTradeDate: latestCompletedTradeDate(now, { market: 'TW' }),
    computedAtMs: nowMs(),
    calendarReady: true,
  });

  const delay = Math.max(0, nextExpectedChangeAt(now) - nowMs());
  timer = setTimeout(() => {
    if (gen !== generation) return; // 已被更新的 schedule 取代
    timer = null;
    recomputeAndSchedule(); // 醒來以「現在」重算（睡眠／背景節流皆同）
  }, delay);
}

function onVisibility() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  recomputeAndSchedule(); // 回前景：重算 + calendar 失敗時的恢復點
}

function bindVisibility() {
  if (visibilityBound || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', onVisibility);
  visibilityBound = true;
}

function unbindVisibility() {
  if (!visibilityBound || typeof document === 'undefined') return;
  document.removeEventListener('visibilitychange', onVisibility);
  visibilityBound = false;
}

export function getExpectedSnapshot(): ExpectedSnapshot {
  return snapshot;
}

/** React `useSyncExternalStore` 用；refCount 0↔1 才 start/stop。 */
export function subscribeExpected(listener: () => void): () => void {
  listeners.add(listener);
  refCount += 1;
  if (refCount === 1) {
    bindVisibility();
    recomputeAndSchedule();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      generation += 1;
      clearTimer();
      unbindVisibility();
    }
  };
}

/** 測試觀測用（不供 production 邏輯使用）。 */
export function __storeDebugState() {
  return { refCount, hasTimer: timer != null, visibilityBound, listeners: listeners.size, generation };
}

/**
 * DEV/test only 守衛：production bundle 呼叫一律 no-op。
 * `import.meta.env.DEV` 在 `vite build` 會被替換成字面 false；MODE==='test' 涵蓋 vitest。
 */
export const __TEST_ONLY_ENABLED: boolean = (() => {
  try {
    const env = (import.meta as any)?.env;
    return env?.DEV === true || env?.MODE === 'test';
  } catch { return false; }
})();

/** DEV/test only：先讓在途工作失效，再清 timer/listener/state。production 為 no-op。 */
export function __resetExpectedStoreForTests(): void {
  if (!__TEST_ONLY_ENABLED) return; // production no-op guard
  generation += 1;
  clearTimer();
  unbindVisibility();
  refCount = 0;
  listeners.clear();
  snapshot = EMPTY;
}
