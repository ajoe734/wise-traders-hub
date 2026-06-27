// 持倉抽屜情境模擬的 Undo/Redo 歷史 hook。
//
// 設計：
//   - past[] / future[] stack；set() push 舊值並清空 future。
//   - 同欄位 300ms 內連續寫入合併為一筆 history（避免 slider 拖動爆量）。
//   - 不同欄位切換 / 超過去抖窗 → 立即斷點。
//   - past 上限 LIMIT，超過從頭丟。
//   - replace() 不寫 history（用於重新 seed，如切換股票）。
//   - reset() 寫 history（user 可 undo 回到調整中狀態）。
//   - 不持久化到 localStorage（純記憶體）。

import { useCallback, useMemo, useRef, useState } from 'react';

const LIMIT = 50;
const DEBOUNCE_MS = 300;

export interface SimHistoryApi<T> {
  state: T;
  set: (next: T | ((prev: T) => T), field?: string) => void;
  /** 替換 state 但不寫入歷史（切換持倉時 seed 用） */
  replace: (next: T) => void;
  reset: (resetValue: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: (seed: T) => void;
}

export function useSimHistory<T>(initial: T): SimHistoryApi<T> {
  const [state, setState] = useState<T>(initial);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const lastRef = useRef<{ field: string | null; ts: number }>({ field: null, ts: 0 });

  const set = useCallback((next: T | ((prev: T) => T), field?: string) => {
    setState((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      const now = Date.now();
      const merge =
        field != null &&
        lastRef.current.field === field &&
        now - lastRef.current.ts < DEBOUNCE_MS;

      if (!merge) {
        setPast((p) => {
          const np = [...p, prev];
          return np.length > LIMIT ? np.slice(np.length - LIMIT) : np;
        });
        setFuture([]);
      }
      lastRef.current = { field: field ?? null, ts: now };
      return resolved;
    });
  }, []);

  const replace = useCallback((next: T) => {
    setState(next);
    lastRef.current = { field: null, ts: 0 };
  }, []);

  const reset = useCallback((resetValue: T) => {
    setState((prev) => {
      setPast((p) => {
        const np = [...p, prev];
        return np.length > LIMIT ? np.slice(np.length - LIMIT) : np;
      });
      setFuture([]);
      lastRef.current = { field: '__reset__', ts: Date.now() };
      return resetValue;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setState((cur) => {
        setFuture((f) => [cur, ...f]);
        return prev;
      });
      lastRef.current = { field: null, ts: 0 };
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setState((cur) => {
        setPast((p) => {
          const np = [...p, cur];
          return np.length > LIMIT ? np.slice(np.length - LIMIT) : np;
        });
        return next;
      });
      lastRef.current = { field: null, ts: 0 };
      return f.slice(1);
    });
  }, []);

  const clear = useCallback((seed: T) => {
    setState(seed);
    setPast([]);
    setFuture([]);
    lastRef.current = { field: null, ts: 0 };
  }, []);

  return useMemo(
    () => ({
      state,
      set,
      replace,
      reset,
      undo,
      redo,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      clear,
    }),
    [state, set, replace, reset, undo, redo, past.length, future.length, clear]
  );
}
