/**
 * 可復用的「測試時鐘注入」工具（harness / E2E 專用，prod 不會用到）。
 *
 * 為什麼要抽出來：ChipsSectionHarnessEntry 的時間覆寫曾經是就地手刻，
 * 造成 `force=stale` 與 `freezeTime` 各自覆寫 Date.now 互踩，STALE badge
 * 間歇性亮不起來。時間注入是「有優先權規則」的東西，規則必須有單一實作
 * 與單元測試，任何新 harness 都直接用這支。
 *
 * ── 覆寫規則（權重由高到低）─────────────────────────────────
 *   1. mode=fresh   最高權重。強制新鮮：now 釘在 `freshAt`（預設 anchor），
 *                   不做任何位移，也不壓縮 ticker → stale 永遠 false。
 *                   與 stale 同時給時，fresh 勝出（明確宣告「我要新鮮」）。
 *   2. mode=stale   位移時鐘：staleAfterMs 之後把 offset 加上 staleShiftMs
 *                   （預設 6 分鐘 = TTL 5 分鐘 + 1），並把 freshness ticker
 *                   的 5s / 30s setTimeout 壓成 tickCompressMs（預設 120ms），
 *                   讓 badge 在測試窗內準時亮起。
 *   3. fixedNow     指定絕對時刻（epoch ms）。有給就釘死，Date.now 不隨真實
 *                   時間前進 → 相對時間文字完全決定論。
 *   4. freeze       沒給 fixedNow 時，凍結在 install 當下的 anchor。
 *   5. 都沒給       不安裝任何覆寫，install 回傳 no-op uninstall。
 *
 *   位移只影響 `offset`，base（fixedNow / freeze / 真實時間）與位移是正交的：
 *   `Date.now() = base() + offset`。
 *
 * ── 使用 ──────────────────────────────────────────────
 *   const clock = installHarnessClock({ mode: 'stale', fixedNow, onShift });
 *   // ...
 *   clock.uninstall();   // 一定要在 cleanup 還原，否則污染其他測試
 */

export type HarnessClockMode = 'stale' | 'fresh' | null;

export interface HarnessClockOptions {
  /** 'stale' 位移時鐘、'fresh' 強制新鮮（權重最高）、null 不做狀態強制 */
  mode?: HarnessClockMode;
  /** 絕對時刻（epoch ms）。給了就釘死 Date.now 的 base */
  fixedNow?: number | null;
  /** 沒有 fixedNow 時，是否凍結在 install 當下 */
  freeze?: boolean;
  /** 位移延遲（ms），預設 800：留時間讓 fetchedAt 收下原始時刻 */
  staleAfterMs?: number;
  /** 位移量（ms），預設 6 分鐘 */
  staleShiftMs?: number;
  /** ticker 壓縮後的間隔（ms），預設 120 */
  tickCompressMs?: number;
  /** mode=fresh 時要釘住的時刻，預設等同 base anchor */
  freshAt?: number | null;
  /** 位移實際套用後回呼（harness 用來打 data-stale-shifted 訊號） */
  onShift?: () => void;
}

export interface HarnessClock {
  /** 是否真的安裝了覆寫 */
  active: boolean;
  /** 解析後的實際 mode（fresh 勝過 stale） */
  mode: HarnessClockMode;
  /** Date.now 的 base 錨點（fixedNow / freeze anchor / 0 表示跟隨真實時間） */
  anchor: number | null;
  /** 立刻套用位移，不等 staleAfterMs（單元測試 / 手動觸發用） */
  shiftNow: () => void;
  /** 還原所有覆寫 */
  uninstall: () => void;
}

/** freshness ticker 只會用這兩種間隔；只壓縮它們，不動其他 timer。 */
export const TICKER_INTERVALS_MS = [5_000, 30_000];

export const STALE_SHIFT_DEFAULT_MS = 6 * 60 * 1000; // TTL 5 分鐘 + 1
export const STALE_AFTER_DEFAULT_MS = 800;
export const TICK_COMPRESS_DEFAULT_MS = 120;

/** 解析 URL 參數的 epoch（接受 epoch ms 或 ISO 字串）。 */
export function parseEpoch(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  // 純數字一律當 epoch ms 處理（不可再落到 Date.parse，'0' 會被解成 2000 年）
  if (!Number.isNaN(n)) return Number.isFinite(n) && n > 0 ? n : null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;

}

/** fresh > stale：兩者同時出現時以 fresh 為準。 */
export function resolveMode(force: string | null | undefined): HarnessClockMode {
  if (!force) return null;
  const parts = String(force).split(/[,+\s]+/).filter(Boolean);
  if (parts.includes('fresh')) return 'fresh';
  if (parts.includes('stale')) return 'stale';
  return null;
}

export function installHarnessClock(opts: HarnessClockOptions = {}): HarnessClock {
  const {
    mode: rawMode = null,
    fixedNow = null,
    freeze = false,
    staleAfterMs = STALE_AFTER_DEFAULT_MS,
    staleShiftMs = STALE_SHIFT_DEFAULT_MS,
    tickCompressMs = TICK_COMPRESS_DEFAULT_MS,
    freshAt = null,
    onShift,
  } = opts;

  const mode = rawMode === 'fresh' ? 'fresh' : rawMode === 'stale' ? 'stale' : null;
  const pinned = fixedNow != null || (mode === 'fresh' && freshAt != null);
  const noop: HarnessClock = {
    active: false,
    mode,
    anchor: null,
    shiftNow: () => {},
    uninstall: () => {},
  };
  if (!mode && !freeze && !pinned) return noop;

  const realNow = Date.now.bind(Date);
  const anchorBase = fixedNow ?? (mode === 'fresh' ? freshAt : null) ?? realNow();
  const frozen = pinned || freeze || mode === 'fresh';
  let offset = 0;

  const originalNow = Date.now;
  Date.now = () => (frozen ? anchorBase : realNow()) + offset;

  const originalSetTimeout = globalThis.setTimeout;
  const compress = mode === 'stale';
  if (compress) {
    (globalThis as any).setTimeout = ((fn: any, delay?: number, ...args: any[]) => {
      const d = TICKER_INTERVALS_MS.includes(delay as number) ? tickCompressMs : delay;
      return originalSetTimeout(fn, d as any, ...args);
    }) as typeof globalThis.setTimeout;
  }

  let shiftTimer: ReturnType<typeof setTimeout> | undefined;
  let shifted = false;
  const shiftNow = () => {
    if (shifted || mode !== 'stale') return;
    shifted = true;
    offset = staleShiftMs;
    onShift?.();
  };
  if (mode === 'stale') {
    shiftTimer = originalSetTimeout(shiftNow, staleAfterMs);
  }

  return {
    active: true,
    mode,
    anchor: frozen ? anchorBase : null,
    shiftNow,
    uninstall: () => {
      if (shiftTimer !== undefined) clearTimeout(shiftTimer as any);
      if (compress) (globalThis as any).setTimeout = originalSetTimeout;
      Date.now = originalNow;
    },
  };
}
