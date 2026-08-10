/**
 * useChipsLifecycle — 抽屜籌碼面對 UI 的**唯一入口**（候選 C）。
 *
 * 之前 ChipsSection 要自己組四台機器：useTwChipsDetail（取數 + 自動重抓）、
 * useChipsState（顯示 5 態）、useChipsBackfill + useChipsAutoBackfill（回補），
 * 外加自己起一個 pending 輪詢計時器，並各自從 payload 重挖 instDays / bsrDays /
 * syncStatus / eligible。任何欄位改名都要改四處。
 *
 * 現在元件只認這一個 hook：事實攤平一次（deriveChipsFacts），三台機器共用，
 * 輪詢／回補／自動重抓的決策都在 chipsLifecycle 純函式裡，元件只讀結果。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/trafficTracker';
import { useTwChipsDetail, isTaiwanChipEligible } from './useTwChipsDetail';
import { useChipsState, type ChipsStateResult } from './useChipsState';
import { useChipsBackfill } from './useChipsBackfill';
import { useChipsAutoBackfill } from './useChipsAutoBackfill';
import {
  deriveChipsFacts,
  planPendingPoll,
  type ChipsFacts,
  type ChipsBackfillPhase,
  type AutoRefreshState,
} from '@/checkup/lib/chipsLifecycle';
import type { TwChipsPayload, ChipsError } from '@/checkup/lib/chipsRepository';

export interface ChipsLifecycle {
  /* 資料 */
  data: TwChipsPayload | null;
  loading: boolean;
  error: ChipsError | null;
  /* 新鮮度 */
  fetchedAt: number | null;
  ageLabel: string;
  fetchedAtClock: string;
  online: boolean;
  stale: boolean;
  /* 顯示 5 態 */
  ui: ChipsStateResult;
  /* 攤平事實（UI 也用得到：instDays / bsrDays 顯示覆蓋度） */
  facts: ChipsFacts;
  /* 自動重抓 */
  autoState: AutoRefreshState;
  nextAutoAt: number | null;
  /* 回補 */
  backfilling: boolean;
  backfillPhase: ChipsBackfillPhase;
  requestBackfill: () => void | Promise<unknown>;
  /* 手動重抓 */
  refetch: (opts?: { auto?: boolean }) => unknown;
}

export function useChipsLifecycle(stockCode: string, enabled = true): ChipsLifecycle {
  const detail = useTwChipsDetail(stockCode, enabled);
  const { data, refetch, fetchedAt } = detail;

  // 事實只攤平一次，三台機器共用
  const facts = useMemo(() => deriveChipsFacts(data), [data]);

  const ui = useChipsState({
    stockCode,
    payload: data,
    error: detail.error,
    chipEligible: isTaiwanChipEligible(stockCode),
  });

  // ── 佇列輪詢：僅 pending/running 時退避輪詢，轉出立即停止 ──
  const attemptsRef = useRef(0);
  useEffect(() => {
    const delay = planPendingPoll(facts, attemptsRef.current);
    if (delay == null) {
      attemptsRef.current = 0;
      return;
    }
    const t = setTimeout(() => {
      attemptsRef.current += 1;
      refetch();
    }, delay);
    return () => clearTimeout(t);
  }, [facts, fetchedAt, refetch]);

  // ── 手動回補 ──
  const { backfilling, requestBackfill } = useChipsBackfill(stockCode);
  const handleBackfill = useCallback(async () => {
    const result = await requestBackfill();
    if (!result) return;
    // 被 module-level 去重／預算擋下：背景 cron 才是主要供給者，這裡靜默即可。
    if (result.skipped) return;
    if (result.ok) {
      toast.success(
        `已排入歷史回補${result.bsrCount ? `（BSR ${result.bsrCount} 個交易日）` : ''}，三大法人約 10 秒、分點約 5–15 分鐘內完成`,
      );
      setTimeout(() => refetch(), 3000);
    } else {
      toast.error(`回補失敗：${String(result.error || '未知錯誤').slice(0, 80)}`);
    }
  }, [requestBackfill, refetch]);


  // ── 自動回補（sparse → triggered → ready / timeout）──
  const { phase: backfillPhase } = useChipsAutoBackfill({
    stockCode,
    hasData: !!data,
    sparse: facts.sparse,
    eligible: facts.eligible,
    syncStatus: facts.syncStatus,
    satisfied: facts.satisfied,
    requestBackfill: handleBackfill,
    onTimeout: ({ stockCode: code, elapsedMs }) =>
      trackEvent('chips_auto_backfill_timeout', {
        stock_code: code,
        elapsed_ms: elapsedMs,
        inst_days: facts.instDays,
        bsr_days: facts.bsrDays,
      }),
  });

  return {
    data,
    loading: detail.loading,
    error: detail.error,
    fetchedAt,
    ageLabel: detail.ageLabel,
    fetchedAtClock: detail.fetchedAtClock,
    online: detail.online,
    stale: detail.stale,
    ui,
    facts,
    autoState: detail.autoState,
    nextAutoAt: detail.nextAutoAt,
    backfilling,
    backfillPhase,
    requestBackfill: handleBackfill,
    refetch,
  };
}

export default useChipsLifecycle;
