/**
 * chipsLifecycle — 抽屜籌碼面的**單一生命週期模組**（候選 C）。
 *
 * 為什麼存在：同一份 payload 過去要餵三台互不相識的狀態機才知道畫面要長怎樣 ——
 *   1. 自動重抓（過期 → 退避 → 停手 → 背景暫停），寫死在 useTwChipsDetail 的 useEffect 裡
 *   2. 顯示 5 態（ineligible / outage / filling / d1_fallback / ready），在 useChipsState
 *   3. 自動回補（sparse → triggered → ready / timeout），在 chipsBackfillMachine
 *   4. 外加 ChipsSection 自己拿 nextPollDelay 起的 pending 輪詢計時器
 * 四者共用同一批事實卻各自從 payload 重新挖一次，任何一個欄位改名就會有一台
 * 悄悄失準，且只有開瀏覽器才看得出來。
 *
 * 這裡把「事實攤平」與「三台機器的決策」收斂成純函式：
 *   deriveChipsFacts(payload) → ChipsFacts     ← 唯一一次從 payload 挖欄位
 *   planAutoRefresh(facts)    → AutoRefreshPlan ← 自動重抓要不要排、排多久
 *   planPendingPoll(facts)    → number | null   ← pending 輪詢的退避延遲
 *   deriveChipsState(...)     → 顯示 5 態（沿用既有實作，於此再輸出）
 *   chipsBackfillReducer(...) → 回補 phase（沿用既有實作，於此再輸出）
 *
 * React 綁定在 `@/checkup/hooks/useChipsLifecycle`，元件只認那一個 hook。
 */
import {
  chipsBackfillReducer,
  initialChipsBackfillState,
  isBackfillSatisfied,
  nextPollDelay,
  AUTO_BACKFILL_TIMEOUT_MS,
  type ChipsBackfillPhase,
} from './chipsBackfillMachine';
import type { TwChipsPayload } from './chipsRepository';

export {
  chipsBackfillReducer,
  initialChipsBackfillState,
  isBackfillSatisfied,
  nextPollDelay,
  AUTO_BACKFILL_TIMEOUT_MS,
};
export type { ChipsBackfillPhase };

/** 自動重抓節流參數（唯一定義處）。 */
export const AUTO_BASE_BACKOFF_MS = 30_000;
export const AUTO_MAX_BACKOFF_MS = 5 * 60_000;
export const AUTO_MAX_FAILURES = 4;

/**
 * idle       = 新鮮，無動作
 * refreshing = 偵測到過期，正在自動重抓
 * failed     = 自動重抓失敗，退避中會再試
 * exhausted  = 連續失敗達上限，停手改由使用者手動
 * paused     = 分頁在背景，暫停自動重抓（回前景立即補抓）
 */
export type AutoRefreshState = 'idle' | 'refreshing' | 'failed' | 'exhausted' | 'paused';

/** 從 payload 攤平出來、三台機器共用的事實。挖欄位只在這裡發生一次。 */
export interface ChipsFacts {
  /** 三大法人日資料點數 */
  instDays: number;
  /** BSR 集中度日資料點數 */
  bsrDays: number;
  /** 歷史點數不足，需要回補 */
  sparse: boolean;
  /** 已補滿（60/20 日 readiness ready 或本地 ≥ 20 天） */
  satisfied: boolean;
  /** 後端 BSR 佇列狀態 */
  syncStatus: string | null;
  /** 後端判定此代號是否可同步 */
  eligible: boolean | null;
  /** 佇列跑動中 → 需要短輪詢 */
  pending: boolean;
}

export const EMPTY_CHIPS_FACTS: ChipsFacts = {
  instDays: 0,
  bsrDays: 0,
  sparse: false,
  satisfied: false,
  syncStatus: null,
  eligible: null,
  pending: false,
};

export function deriveChipsFacts(payload: TwChipsPayload | null | undefined): ChipsFacts {
  if (!payload) return EMPTY_CHIPS_FACTS;
  const instDays = payload.series?.institutional_daily?.length ?? 0;
  const bsrDays = payload.series?.bsr_concentration?.length ?? 0;
  const syncStatus = payload.bsr_sync_status?.status ?? null;
  return {
    instDays,
    bsrDays,
    sparse: instDays < 20 || bsrDays < 5,
    satisfied: isBackfillSatisfied({
      readiness60: payload.readiness?.institutional?.['60']?.state,
      readiness20: payload.readiness?.institutional?.['20']?.state,
      instDays,
    }),
    syncStatus,
    eligible: payload.bsr_sync_status?.eligible ?? null,
    pending: syncStatus === 'pending' || syncStatus === 'running',
  };
}

/* ---------------------------------------------------------------------------
 * 自動重抓（過期保底；stamp 探針才是主力）
 * ------------------------------------------------------------------------- */

export interface AutoRefreshInput {
  /** 這次查詢是否有效（代號合法且啟用） */
  valid: boolean;
  /** 已超過 TTL */
  stale: boolean;
  /** 正在抓（避免疊加） */
  fetching: boolean;
  /** 是否已有一次成功結果 */
  hasResult: boolean;
  online: boolean;
  /** 分頁是否可見 */
  visible: boolean;
  /** 連續失敗次數 */
  failures: number;
  /** 上一次自動重抓的時間（epoch ms） */
  lastAutoAt: number;
  now: number;
}

export interface AutoRefreshPlan {
  /** UI 該顯示的自動更新狀態 */
  state: AutoRefreshState;
  /** 是否要排一次自動重抓 */
  schedule: boolean;
  /** 幾毫秒後執行（schedule 為 true 時有意義） */
  delayMs: number;
  /** 下一次預定執行時間；沒有退避時為 null（UI 不顯示倒數） */
  nextAutoAt: number | null;
}

const NO_PLAN: AutoRefreshPlan = { state: 'idle', schedule: false, delayMs: 0, nextAutoAt: null };

/** 退避階梯：30s → 60s → 120s → 上限 5 分鐘。 */
export function autoBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(AUTO_BASE_BACKOFF_MS * 2 ** (failures - 1), AUTO_MAX_BACKOFF_MS);
}

/**
 * 純決策：現在該不該自動重抓、UI 要顯示哪個狀態。
 * 呼叫端只負責 setTimeout 與回報成功／失敗。
 */
export function planAutoRefresh(input: AutoRefreshInput): AutoRefreshPlan {
  const { valid, stale, fetching, hasResult, online, visible, failures, lastAutoAt, now } = input;
  if (!valid || !stale || fetching || !hasResult || !online) return NO_PLAN;
  if (failures >= AUTO_MAX_FAILURES) {
    return { state: 'exhausted', schedule: false, delayMs: 0, nextAutoAt: null };
  }
  if (!visible) return { state: 'paused', schedule: false, delayMs: 0, nextAutoAt: null };

  const backoff = autoBackoffMs(failures);
  const dueAt = Math.max(lastAutoAt + backoff, now);
  return {
    state: failures > 0 ? 'failed' : 'idle',
    schedule: true,
    delayMs: Math.max(0, dueAt - now),
    nextAutoAt: backoff > 0 ? dueAt : null,
  };
}

/** 自動重抓完成後的下一組計數（純函式，方便測試）。 */
export function reduceAutoRefreshResult(
  failures: number,
  ok: boolean,
): { failures: number; state: AutoRefreshState; nextAutoAt: null } {
  if (ok) return { failures: 0, state: 'idle', nextAutoAt: null };
  const next = failures + 1;
  return {
    failures: next,
    state: next >= AUTO_MAX_FAILURES ? 'exhausted' : 'failed',
    nextAutoAt: null,
  };
}

/* ---------------------------------------------------------------------------
 * 佇列輪詢（僅在 BSR status ∈ {pending, running} 時）
 * ------------------------------------------------------------------------- */

/** 回傳下一次輪詢延遲；不需輪詢時回傳 null（呼叫端據此重置 attempt）。 */
export function planPendingPoll(facts: ChipsFacts, attempt: number): number | null {
  if (!facts.pending) return null;
  return nextPollDelay(attempt);
}
