/**
 * useRenderCounter — dev/test 專用渲染次數偵測。
 *
 * 用途：在開發或測試模式追蹤指定元件的 render 次數，若在滾動時間窗內
 * 超出門檻即 `console.warn` 告警；同時對外開放 `getRenderStats()` 供
 * 測試在 `React.act(...)` 後直接斷言次數。
 *
 * 憲法：
 *  - 生產 build（`import.meta.env.PROD`）走 no-op fast path，不註冊任何
 *    ref/effect，也不會保留計數 Map，確保 tree-shake 後零 runtime cost。
 *  - 計數以 `label` 為主鍵、`id` 為次鍵；`id` 可省略（例如 Sparkline 全域彙總）。
 *  - 告警為冪等：同一鍵在同一 windowMs 內只 warn 一次，避免洗版。
 */

type Key = string;

interface Counter {
  total: number;
  windowStart: number;
  windowCount: number;
  warned: boolean;
}

// 是否啟用（DEV / test）— 生產環境為 false，call site 直接被 minifier 摺掉
const ENABLED = (() => {
  try {
    // Vite 注入的 env — dev / test 為 true，prod build 為 false
    return !!(import.meta as any)?.env && !(import.meta as any).env.PROD;
  } catch {
    return false;
  }
})();

const counters: Map<Key, Counter> = ENABLED ? new Map() : (null as any);

function makeKey(label: string, id?: string | number): Key {
  return id == null || id === '' ? label : `${label}::${id}`;
}

export interface RenderCounterOptions {
  /** 滾動觀察時間窗（ms），預設 1000。 */
  windowMs?: number;
  /** 單一時間窗內 render 次數超過此值即告警，預設 12。 */
  warnThreshold?: number;
  /** 選填識別碼（例如 holding.code）— 用於區分同名元件多個實例。 */
  id?: string | number;
}

/**
 * 讀取即時計數（測試用）。生產環境永遠回 null。
 */
export function getRenderStats(label: string, id?: string | number) {
  if (!ENABLED) return null;
  const key = makeKey(label, id);
  const c = counters.get(key);
  if (!c) return { total: 0, windowCount: 0, warned: false };
  return { total: c.total, windowCount: c.windowCount, warned: c.warned };
}

/**
 * 清空計數（測試用）。生產環境為 no-op。
 */
export function resetRenderStats(label?: string, id?: string | number) {
  if (!ENABLED) return;
  if (!label) {
    counters.clear();
    return;
  }
  counters.delete(makeKey(label, id));
}

/**
 * dev/test 專用 hook。每次 render 遞增，逾門檻 warn。
 * 生產環境（PROD）為 no-op，不會建立 Map/ref/effect。
 */
export function useRenderCounter(label: string, options: RenderCounterOptions = {}): void {
  if (!ENABLED) return;
  const { windowMs = 1000, warnThreshold = 12, id } = options;
  const key = makeKey(label, id);
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

  let c = counters.get(key);
  if (!c) {
    c = { total: 0, windowCount: 0, windowStart: now, warned: false };
    counters.set(key, c);
  }
  c.total += 1;

  if (now - c.windowStart > windowMs) {
    c.windowStart = now;
    c.windowCount = 1;
    c.warned = false;
  } else {
    c.windowCount += 1;
  }

  if (c.windowCount > warnThreshold && !c.warned) {
    c.warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[render-counter] ${key} 在 ${windowMs}ms 內 render ${c.windowCount} 次` +
      `（門檻 ${warnThreshold}）— 檢查 memo/useMemo/useCallback 是否失效`,
    );
  }
}

export default useRenderCounter;
