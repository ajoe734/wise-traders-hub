/**
 * useChipsBackfill — 抽屜籌碼面「手動／自動回補」的唯一對外握手點。
 *
 * 契約：
 *  1. 兩個握手（tw-institutional-daily-sync edge function、enqueue_bsr_backfill RPC）
 *     一律走 Checkup Gateway seam（ADR-0004），元件層不得自行 import supabase client。
 *  2. 回傳結果而非副作用：toast / refetch 由呼叫端（UI）決定。
 *  3. `requestBackfill` 參考穩定（useCallback），可安全放進 effect deps。
 */
import { useCallback, useRef, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';

export interface ChipsBackfillResult {
  /** 兩條回補路徑至少一條成功。 */
  ok: boolean;
  /** BSR 佇列排入的交易日數（RPC 回傳值）。 */
  bsrCount: number;
  /** 兩條都失敗時的錯誤訊息。 */
  error?: string;
}

const DEFAULT_DAYS = 60;

function reasonOf(settled: PromiseSettledResult<unknown>): string | null {
  if (settled.status !== 'rejected') return null;
  const reason: any = settled.reason;
  return reason?.message ? String(reason.message) : String(reason);
}

export function useChipsBackfill(stockCode?: string | null, days: number = DEFAULT_DAYS) {
  const [backfilling, setBackfilling] = useState(false);
  const inFlightRef = useRef(false);

  const requestBackfill = useCallback(async (): Promise<ChipsBackfillResult | null> => {
    if (!stockCode || inFlightRef.current) return null;
    inFlightRef.current = true;
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
