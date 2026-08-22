/**
 * useChipsAutoBackfill — 把 chipsBackfillMachine（純 reducer）接到 React 副作用。
 *
 * 元件只要餵入攤平後的事實，拿回 `phase`；何時排入回補、何時計時、何時送 analytics
 * 全由 machine 決定。原本散在 ChipsSection 的 4 個 useEffect 收斂為 2 個（觀測 + 計時）。
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  AUTO_BACKFILL_TIMEOUT_MS,
  chipsBackfillReducer,
  initialChipsBackfillState,
  type ChipsBackfillEffect,
  type ChipsBackfillEvent,
  type ChipsBackfillPhase,
  type ChipsBackfillState,
} from '@/checkup/lib/chipsBackfillMachine';

interface Queued extends ChipsBackfillState {
  queue: ChipsBackfillEffect[];
}

function queueReducer(prev: Queued, event: ChipsBackfillEvent | { type: 'drain' }): Queued {
  if (event.type === 'drain') {
    return prev.queue.length === 0 ? prev : { ...prev, queue: [] };
  }
  const { state, effects } = chipsBackfillReducer(prev, event);
  if (state === (prev as ChipsBackfillState) && effects.length === 0) return prev;
  return { ...state, queue: effects.length ? [...prev.queue, ...effects] : prev.queue };
}

export interface UseChipsAutoBackfillInput {
  stockCode: string | null;
  hasData: boolean;
  sparse: boolean;
  eligible?: boolean | null;
  syncStatus?: string | null;
  satisfied: boolean;
  /** 上游永久拒絕：一律不自動排入回補。 */
  terminalUnavailable?: boolean;
  /** 排入回補（來自 useChipsBackfill）。 */
  requestBackfill: () => void | Promise<unknown>;
  /** 逾時回報（analytics）。 */
  onTimeout?: (payload: { stockCode: string; elapsedMs: number }) => void;
  timeoutMs?: number;
}

export function useChipsAutoBackfill({
  stockCode,
  hasData,
  sparse,
  eligible,
  syncStatus,
  satisfied,
  terminalUnavailable = false,
  requestBackfill,
  onTimeout,
  timeoutMs = AUTO_BACKFILL_TIMEOUT_MS,
}: UseChipsAutoBackfillInput): { phase: ChipsBackfillPhase } {
  const [machine, dispatch] = useReducer(queueReducer, {
    ...initialChipsBackfillState,
    queue: [],
  });

  // 回呼放進 ref：避免呼叫端沒 memo 化時把 effect 打成無限迴圈
  const requestRef = useRef(requestBackfill);
  requestRef.current = requestBackfill;
  const timeoutCbRef = useRef(onTimeout);
  timeoutCbRef.current = onTimeout;

  // 換股：重置 phase（fired 記憶保留）
  useEffect(() => {
    dispatch({ type: 'stock', stockCode });
  }, [stockCode]);

  // 觀測：每次外部事實變動餵一次 snapshot
  useEffect(() => {
    if (!stockCode) return;
    dispatch({
      type: 'snapshot',
      snapshot: {
        stockCode, hasData, sparse, eligible, syncStatus, satisfied,
        terminalUnavailable, now: Date.now(),
      },
    });
  }, [stockCode, hasData, sparse, eligible, syncStatus, satisfied, terminalUnavailable]);

  // 計時：只有 triggered 才起 30 分鐘計時器
  useEffect(() => {
    if (machine.phase !== 'triggered' || !machine.stockCode) return;
    const code = machine.stockCode;
    const timer = window.setTimeout(() => {
      dispatch({ type: 'timeout', stockCode: code, now: Date.now() });
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [machine.phase, machine.stockCode, timeoutMs]);

  // 排出副作用
  useEffect(() => {
    if (machine.queue.length === 0) return;
    for (const effect of machine.queue) {
      if (effect.type === 'requestBackfill') {
        void requestRef.current?.();
      } else if (effect.type === 'trackTimeout') {
        timeoutCbRef.current?.({ stockCode: effect.stockCode, elapsedMs: effect.elapsedMs });
      }
    }
    dispatch({ type: 'drain' });
  }, [machine.queue]);

  const phase = machine.phase;
  return useMemo(() => ({ phase }), [phase]);
}

export default useChipsAutoBackfill;
