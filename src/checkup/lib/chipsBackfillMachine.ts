/**
 * chipsBackfillMachine — 抽屜籌碼面「自動回補」的純狀態機。
 *
 * 為什麼存在：原本這段邏輯散在 ChipsSection 的 4 個 useEffect（重置／觸發／補滿／逾時），
 * 條件互相牽制、只能靠開瀏覽器手測。這裡把它收斂成 `(state, event) -> {state, effects}`
 * 的純函式，副作用（呼叫回補、送 analytics）由 hook 執行，狀態轉移可單元測試。
 *
 * 生命週期：
 *   idle --(sparse 且可回補)--> triggered --(資料補滿)--> ready
 *                                        \--(30 分鐘未補滿)--> timeout
 * 換股（stock event）一律回到 idle，但「本股已觸發過」的記憶保留，避免來回切換重複排入。
 */

export const AUTO_BACKFILL_TIMEOUT_MS = 30 * 60 * 1000;

/** 輪詢退避階梯（僅在 BSR status ∈ {pending, running} 時使用）。 */
export const POLL_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000, 900_000] as const;

export function nextPollDelay(attempt: number): number {
  const i = Math.max(0, Math.min(Math.trunc(attempt) || 0, POLL_BACKOFF_MS.length - 1));
  return POLL_BACKOFF_MS[i];
}

export type ChipsBackfillPhase = 'idle' | 'triggered' | 'ready' | 'timeout';

export interface ChipsBackfillState {
  phase: ChipsBackfillPhase;
  /** 目前這段 phase 所屬的股票代號（換股後 stale 事件會被忽略）。 */
  stockCode: string | null;
  /** triggered 起算時間，用於逾時 elapsed 計算。 */
  startedAt: number | null;
  /** 已自動觸發過的股票代號（每檔只自動排一次）。 */
  fired: readonly string[];
}

/** 一次觀測的外部事實；由呼叫端從 payload 攤平，machine 不碰 API 型別。 */
export interface ChipsBackfillSnapshot {
  stockCode: string;
  /** payload 是否已到手（沒資料就不做判斷）。 */
  hasData: boolean;
  /** 歷史點數不足，需要回補。 */
  sparse: boolean;
  /** 後端判定此代號是否可同步；false 代表永遠不要自動排。 */
  eligible?: boolean | null;
  /** BSR 同步狀態；pending / running 代表後端已在跑，不重複排。 */
  syncStatus?: string | null;
  /** 資料是否已補滿（見 isBackfillSatisfied）。 */
  satisfied: boolean;
  now: number;
}

export type ChipsBackfillEvent =
  | { type: 'stock'; stockCode: string | null }
  | { type: 'snapshot'; snapshot: ChipsBackfillSnapshot }
  | { type: 'timeout'; stockCode: string; now: number };

export type ChipsBackfillEffect =
  | { type: 'requestBackfill'; stockCode: string }
  | { type: 'trackTimeout'; stockCode: string; elapsedMs: number };

export interface ChipsBackfillTransition {
  state: ChipsBackfillState;
  effects: ChipsBackfillEffect[];
}

export const initialChipsBackfillState: ChipsBackfillState = {
  phase: 'idle',
  stockCode: null,
  startedAt: null,
  fired: [],
};

/** 資料是否已補滿：60/20 日 readiness 任一 ready，或本地日資料 ≥ 20 天。 */
export function isBackfillSatisfied(input: {
  readiness60?: string | null;
  readiness20?: string | null;
  instDays?: number | null;
}): boolean {
  return (
    input.readiness60 === 'ready' ||
    input.readiness20 === 'ready' ||
    (input.instDays ?? 0) >= 20
  );
}

/** 是否應該自動排入回補（純判斷，供測試與 reducer 共用）。 */
export function shouldAutoTrigger(
  state: ChipsBackfillState,
  s: ChipsBackfillSnapshot,
): boolean {
  if (!s.stockCode || !s.hasData || !s.sparse) return false;
  if (s.eligible === false) return false;
  if (s.syncStatus === 'pending' || s.syncStatus === 'running') return false;
  if (state.fired.includes(s.stockCode)) return false;
  if (state.phase === 'triggered' && state.stockCode === s.stockCode) return false;
  return true;
}

function withFired(state: ChipsBackfillState, stockCode: string): readonly string[] {
  return state.fired.includes(stockCode) ? state.fired : [...state.fired, stockCode];
}

export function chipsBackfillReducer(
  state: ChipsBackfillState,
  event: ChipsBackfillEvent,
): ChipsBackfillTransition {
  switch (event.type) {
    case 'stock': {
      if (state.stockCode === event.stockCode && state.phase === 'idle') {
        return { state, effects: [] };
      }
      return {
        state: { phase: 'idle', stockCode: event.stockCode, startedAt: null, fired: state.fired },
        effects: [],
      };
    }

    case 'snapshot': {
      const s = event.snapshot;
      // 換股後殘留的事件：忽略（stock 事件才是唯一切換點）
      if (state.stockCode && state.stockCode !== s.stockCode) return { state, effects: [] };

      // 已補滿 → 收斂到 ready（triggered 才需要收斂；idle 不必進場）
      if (state.phase === 'triggered' && state.stockCode === s.stockCode && s.satisfied) {
        return { state: { ...state, phase: 'ready' }, effects: [] };
      }

      if (shouldAutoTrigger(state, s)) {
        return {
          state: {
            phase: 'triggered',
            stockCode: s.stockCode,
            startedAt: s.now,
            fired: withFired(state, s.stockCode),
          },
          effects: [{ type: 'requestBackfill', stockCode: s.stockCode }],
        };
      }

      return { state, effects: [] };
    }

    case 'timeout': {
      if (state.phase !== 'triggered' || state.stockCode !== event.stockCode) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, phase: 'timeout' },
        effects: [
          {
            type: 'trackTimeout',
            stockCode: event.stockCode,
            elapsedMs: Math.max(0, event.now - (state.startedAt ?? event.now)),
          },
        ],
      };
    }

    default:
      return { state, effects: [] };
  }
}
