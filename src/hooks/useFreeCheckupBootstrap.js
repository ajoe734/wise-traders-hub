// A1: bootstrap 重構
// 將 FreeCheckup 一次性的「localStorage migrate」+「auth → cloud-first 載入 + 衍生事件清理」
// 從 1,000+ 行的 App() 主體抽出，主檔僅保留 setters 與 fetchCalendarEvents 行為。
//
// inline 憲法：本 hook 不渲染任何 JSX，純副作用 + state hydration，可安全外移。
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAuthoritativeQuotes } from "@/checkup/lib/authoritativeQuotes";
import { reconcileHoldingsWithTradeLog } from "@/checkup/lib/tradeLogOps.js";

// P0-3: demoData lazy — 15.3 KB chunk only loads when isDemo branch hits
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
  CLOUD_SYNC_KEYS,
  LOCAL_STORAGE_OWNER_KEY,
} from "@/pages/_freeCheckup/constants";

// ── checkup_trade_memos 保序 ──────────────────────────────────────────────
// 寫入端（saveTradeLogToCloud）以 tradeLog array index 落 sort_index，
// 讀取端一律先看 sort_index。舊資料（migration 前全部 default 0）或帳號合併後
// 兩批 0..n 重號時，退回可觀測的 created_at DESC → id DESC，保證 deterministic。
export function sortTradeMemoRows(rows) {
  const cmpDesc = (a, b) => (a === b ? 0 : a < b ? 1 : -1);
  return [...(rows || [])].sort((x, y) => {
    const sx = Number.isFinite(Number(x?.sort_index)) ? Number(x.sort_index) : 0;
    const sy = Number.isFinite(Number(y?.sort_index)) ? Number(y.sort_index) : 0;
    if (sx !== sy) return sx - sy;
    const cx = x?.created_at || "";
    const cy = y?.created_at || "";
    if (cx !== cy) return cmpDesc(cx, cy);
    return cmpDesc(String(x?.id || ""), String(y?.id || ""));
  });
}

export function mapTradeMemoRow(row) {
  return {
    id: row.id,
    date: row.trade_date || "",
    time: row.trade_time || "",
    action: row.action || "",
    code: row.code || "",
    name: row.name || "",
    qty: row.qty != null ? Number(row.qty) : 0,
    price: row.price != null ? Number(row.price) : 0,
    qa: Array.isArray(row.qa) ? row.qa : [],
  };
}


// 跨帳號 LocalStorage sweeper：當登入 uid 與本機 owner 不符時，
// 主動清掉所有 pf-* 殘留，避免任何 fallback 路徑把上一個帳號的資料當成新帳號的初始值。
function sweepStaleLocalIfOwnerMismatch(userId) {
  if (!userId) return;
  try {
    const ownerId = localStorage.getItem(LOCAL_STORAGE_OWNER_KEY);
    if (ownerId && ownerId === userId) return;
    const keysToWipe = [
      ...CLOUD_SYNC_KEYS,
      "pf-log-v2",
      "pf-calendar-holdings",
    ];
    keysToWipe.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  } catch {}
}

// Demo 收盤價 hydrate：一律經過 price-authority seam（收盤後為當日 snapshot，
// 盤中才是 current_prices），讓訪客看到的價格與看板／收盤分析完全一致。
// 失敗即回傳原本的 DEMO_HOLDINGS（保底），不會擋住 demo 流程。
export async function hydrateDemoHoldingsWithClosePrices(demoHoldings) {
  try {
    const codes = Array.from(
      new Set((demoHoldings || []).map((h) => String(h?.code || "").trim()).filter(Boolean))
    );
    if (codes.length === 0) return demoHoldings;
    const quotes = await fetchAuthoritativeQuotes(codes);
    if (!quotes || Object.keys(quotes).length === 0) return demoHoldings;
    return demoHoldings.map((h) => {
      const q = quotes[String(h?.code || "").trim()];
      if (!q) return h;
      const qty = Number(h?.qty) || 0;
      const changePct = Number(q.changePct) || 0;
      const yesterday = Number.isFinite(q.yesterday) && q.yesterday > 0
        ? q.yesterday
        : (changePct !== 0 ? Math.round((q.price / (1 + changePct / 100)) * 100) / 100 : q.price);
      const change = Math.round((q.price - yesterday) * 100) / 100;
      const todayPnl = Math.round((q.price - yesterday) * qty);
      return {
        ...h,
        price: q.price,
        yesterday,
        change,
        changePct,
        todayPnl,
        todayPct: changePct,
        priceSource: q.source === "snapshot" ? "close" : "db",
        priceUpdatedAt: q.updatedAt,
      };
    });
  } catch {
    return demoHoldings;
  }
}


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
    setDailyReport,
  } = setters;

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    // dev-only debug：只在 dev 環境 + /holding-checkup 下啟用；不輸出 uid/email/token
    const DBG = (() => {
      try {
        if (!import.meta.env || !import.meta.env.DEV) return () => {};
        if (typeof window === "undefined") return () => {};
        if (!window.location?.pathname?.startsWith("/holding-checkup")) return () => {};
        return (...args) => console.log("[checkup-bootstrap]", ...args);
      } catch { return () => {}; }
    })();
    (async () => {
      DBG("start", { authReady, isDemo, mode: isDemo ? "demo" : "full" });
      // ── Demo 模式：直接使用假資料 ──
      if (isDemo) {
        const {
          DEMO_HOLDINGS,
          DEMO_EVENTS,
          DEMO_BRAIN,
          DEMO_CALENDAR,
          DEMO_TRADE_LOG,
          DEMO_ANALYSIS_HISTORY,
          DEMO_DAILY_REPORT,
        } = await import("@/checkup/data/demoData");
        if (cancelled) return;
        setLocalStorageOwner("demo");
        // DEMO_HOLDINGS 已經在 demoData.js 補上 yesterday / todayPnl / todayPct / priceSource='demo'，
        // 使用它而不是 SEED_HOLDINGS，才能確保 HoldingCard 一開始就能顯示 TODAY 欄位與 chip title 的「昨收 X」。
        // 用最新收盤價 hydrate demo（讓訪客看到的持倉價與真實收盤一致）
        const hydratedHoldings = await hydrateDemoHoldingsWithClosePrices(DEMO_HOLDINGS);
        if (cancelled) return;
        setHoldings(hydratedHoldings);
        setTradeLog(DEMO_TRADE_LOG);
        setTargets(INIT_TARGETS);
        setNewsEvents(DEMO_EVENTS);
        setAnalysisHistory(DEMO_ANALYSIS_HISTORY);
        setReversalConditions({});
        setStrategyBrain(DEMO_BRAIN);
        setCalendarEvents(DEMO_CALENDAR);
        if (typeof setDailyReport === "function") setDailyReport(DEMO_DAILY_REPORT);
        setReady(true);
        DBG("demo-seed-applied", {
          holdingsLen: SEED_HOLDINGS.length,
          tradeLogLen: DEMO_TRADE_LOG.length,
          analysisHistoryLen: DEMO_ANALYSIS_HISTORY.length,
          calendarLen: DEMO_CALENDAR.length,
          newsEventsLen: DEMO_EVENTS.length,
        });
        return;
      }


      // ── 雲端優先：批次載入所有 pf-* key ──
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const userId = currentUser?.id;
      if (userId) setCurrentUserId(userId);

      // 跨帳號 sweeper：登入身分 ≠ 本機 owner → 清掉所有 pf-* 殘留，
      // 確保任何 fallback 路徑都不會把上一個帳號的資料當成新帳號的初始值。
      sweepStaleLocalIfOwnerMismatch(userId);

      const wasReset = sessionStorage.getItem("pf-reset-flag") || localStorage.getItem("pf-reset-flag");
      if (wasReset) {
        sessionStorage.removeItem("pf-reset-flag");
        localStorage.removeItem("pf-reset-flag");
      }
      DBG("full-branch", { hasUser: !!userId, hasResetFlag: !!wasReset });


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
      // 雲端污染回寫：authenticated 模式拉到含 demo seed 的舊資料，立即覆寫雲端，避免下次再被拉回來。
      if (removedDemoSeedCount > 0 && userId) {
        try {
          console.warn(`[demo-seed-leak] strip ${removedDemoSeedCount} seed holdings for user ${userId}, writing sanitized list back to cloud`);
          await supabase
            .from("checkup_storage")
            .upsert(
              { user_id: userId, key: "pf-holdings-v2", data: sanitizedHoldings, updated_at: new Date().toISOString() },
              { onConflict: "user_id,key" },
            );
          try { localStorage.setItem("pf-holdings-v2", JSON.stringify(sanitizedHoldings)); } catch {}
        } catch (e) {
          console.error("[demo-seed-leak] failed to upsert sanitized holdings:", e);
        }
      }
      const holdingCodesKey = getHoldingCodesKey(sanitizedHoldings);
      const storedCalendarHoldingCodes = Array.isArray(ce) ? (ce._holdingCodes || "") : "";
      const shouldRebuildDerivedEvents =
        holdingCodesKey.length > 0 &&
        (removedDemoSeedCount > 0 || storedCalendarHoldingCodes !== holdingCodesKey);
      const manualNewsEvents = (Array.isArray(ne) ? ne : []).filter((event) => event?.source !== "calendar");

      let l = [];
      try {
        // RLS 已限制只回自己的 row；但 fallback 必須用 scoped local，
        // 否則跨帳號 LocalStorage 殘留會被當成新帳號的初始 trade log，
        // 接著 auto-save 會把它寫進新帳號的 checkup_trade_memos，造成永久污染。
        // 排序權威：sort_index ASC（寫入時的 tradeLog array index）；
        // migration 前的 legacy row 或帳號合併後重號，以 created_at DESC、id DESC 決勝。
        const { data } = await supabase
          .from("checkup_trade_memos")
          .select("*")
          .order("sort_index", { ascending: true })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false });

        if (data && data.length > 0) {
          l = sortTradeMemoRows(data).map(mapTradeMemoRow);
        } else {
          l = loadScopedLocal("pf-log-v2", [], userId);
        }
      } catch {
        l = loadScopedLocal("pf-log-v2", [], userId);
      }


      if (cancelled) return;

      // checkup_trade_memos 是交易權威；若舊版曾把 holdings 寫成較短陣列，
      // 載入時只補回 logs 可 replay 的缺失代碼，既有行情 enrichment 不動。
      const reconciledHoldings = reconcileHoldingsWithTradeLog(sanitizedHoldings, l);

      DBG("full-apply", {
        rawHoldingsLen: Array.isArray(h) ? h.length : 0,
        sanitizedLen: sanitizedHoldings.length,
        reconciledLen: reconciledHoldings.length,
        removedDemoSeedCount,
        tradeLogLen: l.length,
      });
      setHoldings(reconciledHoldings); setTradeLog(l); setTargets(t);
      setStrategyBrain(sb); setCalendarEvents(shouldRebuildDerivedEvents ? [] : ce);


      const hasHoldings = reconciledHoldings.length > 0;
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
        fetchCalendarEventsRef.current(reconciledHoldings, resetGuardRef.current, []);
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
