/**
 * useHoldingDetailViewModel — 抽屜的唯一狀態組裝點。
 *
 * 對外介面很窄（一組資料 in、一個 view-model out），實作藏了：
 *   目標價歷史／論點追蹤的自帶抓取與整形、情境模擬 undo/redo 狀態、
 *   以及 holdingDetailViewModel 的全部純推導。
 * 元件只負責渲染 view-model，不再自己算數字。
 */
import { useEffect, useMemo } from 'react';
import { useSimHistory } from '@/checkup/hooks/useSimHistory';
import { useTargetPriceHistory } from '@/checkup/hooks/useTargetPriceHistory';
import { useThesisTracking } from '@/checkup/hooks/useThesisTracking';
import { computeScenario, isDirty } from '@/checkup/components/freecheckup/holdingScenario';
import {
  deriveHoldingDetailViewModel,
  buildSimInput,
  shapeTargetPriceHistory,
  shapeThesisTracking,
} from '@/checkup/lib/holdingDetailViewModel';

export function useHoldingDetailViewModel({
  holding,
  decision = null,
  meta = null,
  baseTarget = null,
  totalPortfolioValue = 0,
  sparkData30D = [],
  normalizedEvents = [],
  orderedDisplayed = [],
  tradeLog = null,
  targetPriceHistory: targetPriceHistoryProp = null,
  thesisTracking: thesisTrackingProp = null,
}: any) {
  const code = holding?.code ?? null;

  // A2 資料通線：父層未注入時自帶 hooks（只在有選取股票時啟用）。
  const { rows: tpHistoryRows } = useTargetPriceHistory(code, {
    limit: 30,
    enabled: !targetPriceHistoryProp && !!code,
  });
  const { theses } = useThesisTracking() as any;

  const targetPriceHistory = useMemo(
    () => targetPriceHistoryProp ?? shapeTargetPriceHistory(tpHistoryRows, code),
    [targetPriceHistoryProp, tpHistoryRows, code],
  );
  const thesisTracking = useMemo(
    () => thesisTrackingProp ?? shapeThesisTracking(theses, code),
    [thesisTrackingProp, theses, code],
  );

  // ── 情境模擬 ──
  const simHistory = useSimHistory({ target: '', deltaQty: 0, buyMorePrice: '', stopPrice: '' });
  const sim = simHistory.state;
  useEffect(() => {
    simHistory.clear({ target: baseTarget ?? '', deltaQty: 0, buyMorePrice: '', stopPrice: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, baseTarget]);

  const simInput = useMemo(
    () => buildSimInput(holding, sim, baseTarget),
    [holding?.cost, holding?.qty, holding?.price, sim, baseTarget], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const scenario = useMemo(() => computeScenario(simInput), [simInput]);
  const dirty = useMemo(() => isDirty(simInput, baseTarget), [simInput, baseTarget]);

  const vm = useMemo(
    () => deriveHoldingDetailViewModel({
      holding, decision, meta, baseTarget, totalPortfolioValue,
      sparkData30D, normalizedEvents, orderedDisplayed, tradeLog,
      targetPriceHistory, thesisTracking, sim, scenario, dirty,
    }),
    [holding, decision, meta, baseTarget, totalPortfolioValue, sparkData30D,
      normalizedEvents, orderedDisplayed, tradeLog, targetPriceHistory,
      thesisTracking, sim, scenario, dirty],
  );

  return { ...vm, sim, setSim: simHistory.set, simHistory, simInput, scenario, dirty };
}

export default useHoldingDetailViewModel;
