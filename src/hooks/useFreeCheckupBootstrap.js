// A1: bootstrap 重構
// 將 FreeCheckup 一次性的「localStorage migrate」+「auth → cloud-first 載入 + 衍生事件清理」
// 從 1,000+ 行的 App() 主體抽出，主檔僅保留 setters 與 fetchCalendarEvents 行為。
//
// inline 憲法：本 hook 不渲染任何 JSX，純副作用 + state hydration，可安全外移。
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_EVENTS, DEMO_BRAIN } from "@/checkup/data/demoData";
import { INIT_HOLDINGS as SEED_HOLDINGS } from "@/checkup/seedData";
import {
  INIT_TARGETS,
  setLocalStorageOwner,
  setCurrentUserId,
  loadAllFromCloud,
  loadScopedLocal,
  loadLocal,
  save,
  stripDemoSeedHoldings,
  getHoldingCodesKey,
} from "@/pages/_freeCheckup/constants";

/**
 * One-time localStorage migration（pf-holdings-v2 schema bump）
 */
export function useHoldingsMigration() {
  useEffect(() => {
    try {
      const migrated = localStorage.getItem("pf-holdings-v2-migrated");
      if (!migrated) {
        localStorage.removeItem("pf-holdings-v2");
        localStorage.setItem("pf-holdings-v2-migrated", "1");
      }
    } catch {}
  }, []);
}

/**
 * 主 hydration：等 auth ready → demo 走 seed；否則 cloud-first → local fallback。
 * 處理 trade memos 從 supabase 拉回，並依持倉碼差異重建衍生事件。
 *
 * @param {object} args
 * @param {boolean} args.authReady
 * @param {boolean} args.isDemo
 * @param {object}  args.setters    需要全部 setters（依原 App() 行為）
 * @param {React.MutableRefObject<number>} args.resetGuardRef
 * @param {React.MutableRefObject<Function>} args.fetchCalendarEventsRef
 *        指向 App() 內 fetchCalendarEvents（保 ref 以免 hook 依賴鎖死）
 */
export function useFreeCheckupBootstrap({
  authReady,
  isDemo,
  setters,
  resetGuardRef,
  fetchCalendarEventsRef,
}) {
  const {
    setHoldings,
    setTradeLog,
    setTargets,
    setNewsEvents,
    setAnalysisHistory,
    setReversalConditions,
    setStrategyBrain,
    setCalendarEvents,
    setReady,
    setCloudSync,
  } = setters;

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      // ── Demo 模式：直接使用假資料 ──
      if (isDemo) {
        setLocalStorageOwner("demo");
        setHoldings(SEED_HOLDINGS);
        setTradeLog([]);
        setTargets(INIT_TARGETS);
        setNewsEvents(DEMO_EVENTS);
        setAnalysisHistory([]);
        setReversalConditions({});
        setStrategyBrain(DEMO_BRAIN);
        setCalendarEvents([]);
        setReady(true);
        return;
      }

      // ── 雲端優先：批次載入所有 pf-* key ──
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const userId = currentUser?.id;
      if (userId) setCurrentUserId(userId);

      const wasReset = sessionStorage.getItem("pf-reset-flag") || localStorage.getItem("pf-reset-flag");
      if (wasReset) {
        sessionStorage.removeItem("pf-reset-flag");
        localStorage.removeItem("pf-reset-flag");
      }

      let cloud = {};
      if (!wasReset && userId) {
        cloud = await loadAllFromCloud(userId);
      }

      const pick = (key, fallback) => {
        if (Object.prototype.hasOwnProperty.call(cloud, key)) {
          if (userId) setLocalStorageOwner(userId);
          try { localStorage.setItem(key, JSON.stringify(cloud[key])); } catch {}
          return cloud[key];
        }
        return loadScopedLocal(key, fallback, userId);
      };

      const h = pick("pf-holdings-v2", []);
      const t = pick("pf-targets-v1", {});
      const ne = pick("pf-news-events-v1", []);
      const ah = pick("pf-analysis-history-v1", []);
      const rc = pick("pf-reversal-v1", {});
      const sb = pick("pf-brain-v1", null);
      const ceRaw = pick("pf-calendar-v1", null);

      let ce;
      if (ceRaw && !Array.isArray(ceRaw) && ceRaw.events) {
        ce = ceRaw.events;
        ce._holdingCodes = ceRaw.holdingCodes || "";
      } else {
        ce = ceRaw || [];
      }

      const sanitizedHoldings = stripDemoSeedHoldings(Array.isArray(h) ? h : []);
      const removedDemoSeedCount = (Array.isArray(h) ? h.length : 0) - sanitizedHoldings.length;
      const holdingCodesKey = getHoldingCodesKey(sanitizedHoldings);
      const storedCalendarHoldingCodes = Array.isArray(ce) ? (ce._holdingCodes || "") : "";
      const shouldRebuildDerivedEvents =
        holdingCodesKey.length > 0 &&
        (removedDemoSeedCount > 0 || storedCalendarHoldingCodes !== holdingCodesKey);
      const manualNewsEvents = (Array.isArray(ne) ? ne : []).filter((event) => event?.source !== "calendar");

      let l = [];
      try {
        const { data } = await supabase.from("checkup_trade_memos").select("*").order("created_at", { ascending: false });
        if (data && data.length > 0) {
          l = data.map(row => ({
            id: row.id,
            date: row.trade_date || "",
            time: row.trade_time || "",
            action: row.action || "",
            code: row.code || "",
            name: row.name || "",
            qty: row.qty != null ? Number(row.qty) : 0,
            price: row.price != null ? Number(row.price) : 0,
            qa: Array.isArray(row.qa) ? row.qa : [],
          }));
        } else {
          l = loadLocal("pf-log-v2", []);
        }
      } catch {
        l = loadLocal("pf-log-v2", []);
      }

      if (cancelled) return;

      setHoldings(sanitizedHoldings); setTradeLog(l); setTargets(t);
      setStrategyBrain(sb); setCalendarEvents(shouldRebuildDerivedEvents ? [] : ce);

      const hasHoldings = sanitizedHoldings.length > 0;
      if (!hasHoldings) {
        setNewsEvents([]); setAnalysisHistory([]); setReversalConditions({});
        setStrategyBrain(null); setCalendarEvents([]);
        save("pf-news-events-v1", []); save("pf-analysis-history-v1", []);
        save("pf-reversal-v1", {}); save("pf-brain-v1", null); save("pf-calendar-v1", []);
        save("pf-targets-v1", {});
        setTargets({});
      } else {
        setNewsEvents(shouldRebuildDerivedEvents ? manualNewsEvents : ne);
        setAnalysisHistory(ah); setReversalConditions(rc);
      }
      setReady(true);
      setCloudSync(true);

      if (shouldRebuildDerivedEvents && typeof fetchCalendarEventsRef?.current === "function") {
        fetchCalendarEventsRef.current(sanitizedHoldings, resetGuardRef.current, []);
      }
    })();
    return () => { cancelled = true; };
    // setters / refs 為 stable ref，僅依 authReady + isDemo 觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, isDemo]);
}

/**
 * 便利包裝：自動把 fetchCalendarEvents 包成 ref。
 */
export function useFetchCalendarEventsRef(fetchCalendarEvents) {
  const ref = useRef(fetchCalendarEvents);
  useEffect(() => { ref.current = fetchCalendarEvents; }, [fetchCalendarEvents]);
  return ref;
}
