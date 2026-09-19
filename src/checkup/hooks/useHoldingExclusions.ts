/**
 * useHoldingExclusions — 單檔持倉刪除的 **production seam**。
 *
 * 這支是 UI（HoldingsDetailPanel 刪除鈕）與純函式模型
 * （holdingExclusions / holdingDeleteService）之間的唯一接線點：
 *   - 讀：`pf-holding-exclusions-v1`（localStorage，登入後由 checkup_storage 覆寫）
 *   - 寫：gateway 三步（exclusions → holdings → calendar），任一步失敗完整 rollback
 *   - 帳務隔離：gateway.writableTables 只宣告 checkup_storage，
 *     service 會擋掉任何 trade_records / user_performances 等帳務表。
 *
 * 語意：刪除 = 移出目前持倉 + 留下 owner-scoped 排除標記；
 * 不建立賣出交易、不改交易紀錄、不動資金。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  HOLDING_EXCLUSIONS_KEY,
  applyHoldingExclusions,
  parseExclusions,
  type CalendarHoldingsPayload,
  type HoldingExclusion,
  type HoldingLike,
} from '@/checkup/lib/holdingExclusions';
import {
  applyScreenshotImportWithExclusions,
  clearExclusionForManualAdd,
  deleteHoldingWithExclusion,
  type HoldingPersistenceGateway,
} from '@/checkup/lib/holdingDeleteService';

export { readLocalExclusions } from '@/checkup/lib/holdingExclusionsStorage';

export interface UseHoldingExclusionsArgs {
  holdings: HoldingLike[] | null | undefined;
  setHoldings: (updater: HoldingLike[] | ((prev: HoldingLike[]) => HoldingLike[])) => void;
  getUserId: () => string | null | undefined;
  isDemo?: boolean;
  ready?: boolean;
  /** 測試 / harness 注入；預設用真實 checkup_storage gateway。 */
  gateway?: HoldingPersistenceGateway;
}

export function createCheckupStorageGateway({
  getUserId,
  setHoldings,
}: {
  getUserId: () => string | null | undefined;
  setHoldings: UseHoldingExclusionsArgs['setHoldings'];
}): HoldingPersistenceGateway {
  const upsert = async (key: string, data: unknown) => {
    const uid = getUserId();
    if (!uid) return;
    const { error } = await supabase
      .from('checkup_storage')
      .upsert({ user_id: uid, key, data: (data ?? {}) as never, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
    if (error) throw error;
  };
  return {
    // 只宣告 checkup_storage：任何帳務表都不在寫入面上
    writableTables: ['checkup_storage'],
    async writeExclusions(rows: HoldingExclusion[]) {
      writeLocalExclusions(rows);
      await upsert(HOLDING_EXCLUSIONS_KEY, { codes: rows });
    },
    async writeHoldings(rows: HoldingLike[]) {
      // pf-holdings-v2 的本機 + 雲端寫入由 FreeCheckup 既有 auto-save effect 負責，
      // 這裡只推 state，確保「刪除後畫面與儲存」同一份資料。
      setHoldings(rows);
    },
    async writeCalendar(payload: CalendarHoldingsPayload) {
      await upsert('pf-calendar-holdings', payload);
    },
  };
}

export function useHoldingExclusions({
  holdings,
  setHoldings,
  getUserId,
  isDemo = false,
  ready = true,
  gateway: injectedGateway,
}: UseHoldingExclusionsArgs) {
  const [exclusions, setExclusions] = useState<HoldingExclusion[]>(() => readLocalExclusions());
  const holdingsRef = useRef(holdings);
  holdingsRef.current = holdings;

  // 登入後從雲端把 owner-scoped 排除清單拉回（雲端優先，本機為 fallback）
  useEffect(() => {
    if (!ready || isDemo) return;
    const uid = getUserId();
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('user_id', uid)
          .eq('key', HOLDING_EXCLUSIONS_KEY)
          .maybeSingle();
        if (cancelled || !data) return;
        const rows = parseExclusions((data as { data?: unknown }).data);
        writeLocalExclusions(rows);
        setExclusions(rows);
      } catch { /* 本機值保底 */ }
    })();
    return () => { cancelled = true; };
  }, [ready, isDemo, getUserId]);

  const gateway = useMemo(
    () => injectedGateway ?? createCheckupStorageGateway({ getUserId, setHoldings }),
    [injectedGateway, getUserId, setHoldings],
  );

  /** 刪除單一持倉（含排除標記）。回傳 service 結果供 UI 顯示。 */
  const deleteHolding = useCallback(async (code: unknown) => {
    const result = await deleteHoldingWithExclusion({
      gateway,
      holdings: holdingsRef.current,
      exclusions,
      code,
    });
    if (result.ok) setExclusions(result.exclusions);
    else if (result.rolledBack) setHoldings(result.holdings);
    return result;
  }, [gateway, exclusions, setHoldings]);

  /** 手動重新加入同一檔 → 清除排除標記。 */
  const clearExclusion = useCallback(async (code: unknown) => {
    const result = await clearExclusionForManualAdd({ gateway, exclusions, code });
    if (result.ok) setExclusions(result.exclusions);
    return result;
  }, [gateway, exclusions]);

  const clearExclusions = useCallback(async (codes: unknown[]) => {
    let current = exclusions;
    for (const code of codes) {
      const result = await clearExclusionForManualAdd({ gateway, exclusions: current, code });
      if (result.ok) current = result.exclusions;
    }
    setExclusions(current);
    return current;
  }, [gateway, exclusions]);

  /** 截圖重匯：預設略過已排除個股，confirmedCodes 才恢復。 */
  const applyImport = useCallback(async <T extends HoldingLike>(incoming: T[], confirmedCodes: unknown[] = []) => {
    const result = await applyScreenshotImportWithExclusions({ gateway, incoming, exclusions, confirmedCodes });
    if (result.ok) setExclusions(result.exclusions);
    return result;
  }, [gateway, exclusions]);

  /** replay / hydration 之後一律過這層，被刪掉的個股不得復活。 */
  const filterHoldings = useCallback(
    <T extends HoldingLike>(rows: T[] | null | undefined) => applyHoldingExclusions(rows, exclusions),
    [exclusions],
  );

  return { exclusions, gateway, deleteHolding, clearExclusion, clearExclusions, applyImport, filterHoldings };
}
