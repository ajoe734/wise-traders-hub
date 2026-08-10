/**
 * useChipsBackfill — 抽屜籌碼面「手動／自動回補」的唯一對外握手點。
 *
 * 契約：
 *  1. 兩個握手（tw-institutional-daily-sync edge function、enqueue_bsr_backfill RPC）
 *     一律走 Checkup Gateway seam（ADR-0004），元件層不得自行 import supabase client。
 *  2. 回傳結果而非副作用：toast / refetch 由呼叫端（UI）決定。
 *  3. `requestBackfill` 參考穩定（useCallback），可安全放進 effect deps。
 *  4. **lazy 只是 fallback**：背景 cron（chips-prefetch-enqueue-hourly）才是主要供給者。
 *     因此這裡用 **module-level** in-flight map + attempt budget 去重：
 *     同一代號同時只允許一個回補在途，且每個 session 每檔最多 MAX_ATTEMPTS 次，
 *     避免抽屜反覆開關造成 job storm。
 */
import { useCallback, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';

export interface ChipsBackfillResult {
  /** 兩條回補路徑至少一條成功。 */
  ok: boolean;
  /** BSR 佇列排入的交易日數（RPC 回傳值）。 */
  bsrCount: number;
  /** 兩條都失敗時的錯誤訊息。 */
  error?: string;
  /** 因為去重／預算被擋下時的原因（呼叫端可據此不顯示 toast）。 */
  skipped?: 'in_flight' | 'budget_exhausted';
}

const DEFAULT_DAYS = 60;

/** 每個 session 每檔最多送幾次 lazy 回補。 */
export const MAX_ATTEMPTS_PER_STOCK = 2;

/** module-level：跨元件掛載共用，抽屜開關不會重置。 */
const inFlight = new Set<string>();
const attempts = new Map<string, number>();

/** 測試用：重置 module-level 去重狀態。 */
export function __resetChipsBackfillBudget(): void {
  inFlight.clear();
  attempts.clear();
}

function reasonOf(settled: PromiseSettledResult<unknown>): string | null {
  if (settled.status !== 'rejected') return null;
  const reason = settled.reason as { message?: unknown } | undefined;
  if (reason && typeof reason.message === 'string') return reason.message;
  return String(settled.reason);
}

export function useChipsBackfill(stockCode?: string | null, days: number = DEFAULT_DAYS) {
  const [backfilling, setBackfilling] = useState(false);

  const requestBackfill = useCallback(async (): Promise<ChipsBackfillResult | null> => {
    if (!stockCode) return null;
    if (inFlight.has(stockCode)) return { ok: false, bsrCount: 0, skipped: 'in_flight' };
    const used = attempts.get(stockCode) ?? 0;
    if (used >= MAX_ATTEMPTS_PER_STOCK) {
      return { ok: false, bsrCount: 0, skipped: 'budget_exhausted' };
    }
    inFlight.add(stockCode);
    attempts.set(stockCode, used + 1);
    setBackfilling(true);

    try {
      const gateway = getCheckupGateway();
      const [instRes, bsrRes] = await Promise.allSettled([
        gateway.invoke('tw-institutional-daily-sync', {
          mode: 'backfill_stock',
          stock_id: stockCode,
          days,
        }),
        gateway.rpc<number>('enqueue_bsr_backfill', { p_stock_id: stockCode, p_days: days }),
      ]);

      const instOk = instRes.status === 'fulfilled';
      const bsrOk = bsrRes.status === 'fulfilled';
      if (instOk || bsrOk) {
        return {
          ok: true,
          bsrCount: bsrOk ? Number(bsrRes.value ?? 0) || 0 : 0,
        };
      }
      return {
        ok: false,
        bsrCount: 0,
        error: reasonOf(instRes) || reasonOf(bsrRes) || '未知錯誤',
      };
    } finally {
      inFlightRef.current = false;
      setBackfilling(false);
    }
  }, [stockCode, days]);

  return { backfilling, requestBackfill };
}

export default useChipsBackfill;
