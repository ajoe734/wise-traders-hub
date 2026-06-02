// E-Maint-R1 (holdings audit 2026-05 第二輪)
// ─────────────────────────────────────────────
// 把「只有 HoldingsTab 會用到的 6 個 derived useMemo」下沉到 hook，
// 讓 parent FreeCheckup 不再需要透傳 displayed / variantsMap / orderedDisplayed /
// firstFeatureCode / actionPriorityItems / strategyOptions。
//
// 為什麼這些可以下沉？
//   ✅ 純函式 of (sorted, decisionsMap, STOCK_META, H, showAll, globalPriorityList)
//   ✅ 父層其他 region 完全不依賴這些 derived（已 grep 確認）
//
// 為什麼 globalSortedList / exitList / reviewList / upcomingList 仍留在父層？
//   ❌ 它們被 drawer 來源（drawerSourceList）/ KPI 計數（exitListCount 等）共用，
//      留在父層做單一 source of truth，避免雙重 memo。

import { useMemo } from 'react';
import { assignCardVariants } from '@/checkup/hooks/useHoldingDecision';

const VARIANT_ORDER = { ink: 0, accent: 1, plain: 2 };

/**
 * 把 HoldingsTab 的卡片牆 derived 全部收斂到一處。
 *
 * @param {object} args
 * @param {Array}  args.sorted              filteredSortedList（父層已篩+排）
 * @param {object} args.decisionsMap        持倉決策表
 * @param {object} args.stockMeta           STOCK_META 全表
 * @param {Array}  args.holdings            原始 H（給 strategyOptions / 顯示總筆數用）
 * @param {boolean} args.showAll
 * @param {Array}  args.globalPriorityList  父層計算（不受 filter 影響的優先三筆）
 */
export function useHoldingsDerivations({
  sorted,
  decisionsMap,
  stockMeta,
  holdings,
  showAll,
  globalPriorityList,
}) {
  // C11 (audit 2026-06)：所有輸入做防呆預設，避免 bootstrap 尚未完成 / 上游回傳 undefined 時崩潰。
  // H12 (audit 2026-06)：safeDecisionsMap / safeStockMeta / safeGlobalPriorityList 用 useMemo
  //                       穩定 reference，否則 `decisionsMap || {}` 每 render 都產生新物件，
  //                       導致下游 variantsMap / actionPriorityItems memo 全部失效。
  const safeSorted = Array.isArray(sorted) ? sorted : [];
  const safeDecisionsMap = useMemo(() => decisionsMap || {}, [decisionsMap]);
  const safeStockMeta = useMemo(() => stockMeta || {}, [stockMeta]);
  const safeGlobalPriorityList = useMemo(
    () => (Array.isArray(globalPriorityList) ? globalPriorityList : []),
    [globalPriorityList]
  );

  // 1. displayed — 不展開時 slice(0, 12)
  const displayed = useMemo(
    () => (showAll ? safeSorted : safeSorted.slice(0, 12)),
    [showAll, safeSorted]
  );

  // 2. variantsMap — 卡片 ink/accent/plain 配額
  const variantsMap = useMemo(
    () => assignCardVariants(displayed, {
      getActionType: (it) => safeDecisionsMap[it.code]?.actionType || 'hold',
      getPct: (it) => it.pct ?? 0,
    }),
    [displayed, safeDecisionsMap]
  );

  // 3. orderedDisplayed — 依 variant 重新排序（ink → accent → plain）
  const orderedDisplayed = useMemo(() => {
    return [...displayed].sort((a, b) => {
      const va = VARIANT_ORDER[variantsMap.get(a.code) || 'plain'];
      const vb = VARIANT_ORDER[variantsMap.get(b.code) || 'plain'];
      return va - vb;
    });
  }, [displayed, variantsMap]);

  // 4. firstFeatureCode — 第一張是否為 ink feature
  const firstFeatureCode = useMemo(
    () =>
      orderedDisplayed[0] && variantsMap.get(orderedDisplayed[0].code) === 'ink'
        ? orderedDisplayed[0].code
        : null,
    [orderedDisplayed, variantsMap]
  );

  // 5. actionPriorityItems — 預先組裝（含 tag/desc），避免子元件接 decisionsMap+stockMeta 全表
  const actionPriorityItems = useMemo(
    () =>
      safeGlobalPriorityList.map((h) => {
        const dec = safeDecisionsMap[h.code];
        const tag =
          dec?.actionType === 'exit'
            ? 'EXIT'
            : dec?.actionType === 'review'
            ? 'REVIEW'
            : 'WATCH';
        const desc = dec?.actionText
          ? dec.actionText.length > 32
            ? dec.actionText.slice(0, 30) + '…'
            : dec.actionText
          : safeStockMeta[h.code]?.strategy || '持續監控';
        return { code: h.code, name: h.name, pct: h.pct ?? 0, tag, desc };
      }),
    [safeGlobalPriorityList, safeDecisionsMap, safeStockMeta]
  );

  // 6. strategyOptions — 篩選器的動態題材選項
  const strategyOptions = useMemo(() => {
    const set = new Set();
    (holdings || []).forEach((h) => {
      const s = safeStockMeta[h.code]?.strategy;
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [holdings, safeStockMeta]);

  return {
    displayed,
    variantsMap,
    orderedDisplayed,
    firstFeatureCode,
    actionPriorityItems,
    strategyOptions,
  };
}
