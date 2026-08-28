import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, lazy, Suspense } from "react";
import { SEOLite as SEO } from "@/components/SEOLite";
// Self-hosted Noto Sans/Serif TC (chinese-traditional 子集 + latin)
import "@fontsource/noto-sans-tc/chinese-traditional-400.css";
import "@fontsource/noto-sans-tc/chinese-traditional-500.css";
import "@fontsource/noto-sans-tc/chinese-traditional-700.css";
import "@fontsource/noto-serif-tc/chinese-traditional-400.css";
import "@fontsource/noto-serif-tc/chinese-traditional-600.css";
import "@fontsource/noto-serif-tc/chinese-traditional-700.css";
import "@/checkup/styles/checkupTokens.css";

import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useCheckupMode } from "@/checkup/contexts/CheckupModeContext";
// P0-3: demoData (~15 KB) lazy — only fetched when isDemo handlers run
import { simulateSteps, demoDelay } from "@/checkup/utils/demoSimulate";

import { STOCK_META, IND_COLOR } from "@/checkup/seedData";
import { C as ThemeC, L as ThemeL, A, alpha } from "@/checkup/theme";
import { calcWeightedAvgCost, calcNetSettlement, calcPnlWithNet, calcRemainingCostAfterPartialSell } from "@/checkup/lib/holdingMath";
import { buildDecision, sortByDecisionPriority, getEffectiveStatus } from "@/checkup/lib/holdingEventUtils";
import { normalizeEventRecord } from "@/checkup/lib/eventUtils";
import { URGENCY_RANK, CONF_RANK, makeCompareByPriority, holdingsValueKeyShort } from "@/checkup/lib/holdingsSort";
// E-Maint-R1: assignCardVariants 已下沉至 useHoldingsDerivations，父層不再需要
// coerceStocksString moved into NewsTab (lazy chunk) — keep out of main bundle
import { callEdge } from "@/checkup/lib/edgeInvoke";
import { getAutoRefreshMinutes } from "@/checkup/lib/autoRefreshInterval";
import { readLastUpdate, writeLastUpdate } from "@/checkup/lib/holdingsLastUpdate";
import { preloadKnowledgeBase } from "@/checkup/lib/knowledgeBase";
import { mergeCalendarToNewsEvents } from "@/checkup/lib/calendarSync";
import { trackRaw } from "@/lib/analytics/events";
import { useHoldingsSync } from "@/pages/_freeCheckup/useHoldingsSync";

// ADR-0005：shell 只吃模組 free surface barrel，不再深挖 freecheckup 實作檔。
// 一律 lazy import，保住七個 tab 的 code splitting。
const HoldingsTab = lazy(() => import("@/checkup/modules/holdings/free").then((m) => ({ default: m.HoldingsTab })));
const NewsTab = lazy(() => import("@/checkup/modules/closing/free").then((m) => ({ default: m.NewsTab })));
const EventsTab = lazy(() => import("@/checkup/modules/events/free").then((m) => ({ default: m.EventsTab })));
const DailyTab = lazy(() => import("@/checkup/modules/closing/free").then((m) => ({ default: m.DailyTab })));
const LogTab = lazy(() => import("@/checkup/modules/tradeIO/free").then((m) => ({ default: m.LogTab })));
const TradeTab = lazy(() => import("@/checkup/modules/tradeIO/free").then((m) => ({ default: m.TradeTab })));
const ResearchTab = lazy(() => import("@/checkup/modules/research/free").then((m) => ({ default: m.ResearchTab })));
// Batch C §6.3 / §6.5：上傳 modal + 一次性引導 + 頁腳 demo hint
const TradeUploadModal = lazy(() => import("@/checkup/modules/tradeIO/free").then((m) => ({ default: m.TradeUploadModal })));
// ADR-0005 §5：BatchParsePanel 屬 M4 TradeIO，由 shell 以槽位注入 HoldingsTab（M1），避免手足模組直連
const BatchParsePanel = lazy(() => import("@/checkup/modules/tradeIO/free").then((m) => ({ default: m.BatchParsePanel })));
// OnboardingOverlay / DemoFooterHint 屬 shell 自己的 UI，不歸任何模組（ADR-0005 §2）
const OnboardingOverlay = lazy(() => import("@/checkup/components/freecheckup/OnboardingOverlay"));
const DemoFooterHint = lazy(() => import("@/checkup/components/freecheckup/DemoFooterHint"));


// Phase 3 A1: lazy-load heavy/conditional UI to shrink initial bundle
const Md = lazy(() => import("@/checkup/components/Md"));
// Constants & helpers extracted to _freeCheckup/constants.js (pure, no React state).
// Inline 憲法仍適用於 JSX / hooks；本 import 只搬「不依賴 component state」的部分。
import {
  classifyAttempt,
  deriveSuggestion,
  RETRY_POLICY,
  avgTarget,
  INIT_HOLDINGS,
  INIT_WATCHLIST,
  C,
  WB,
  wbTone,
  EMPTY_HOLDINGS,
  // E-Maint-R6: Sparkline 不再由父層 import — HoldingCard 直接從 constants.jsx 取
  TYPE_COLOR,
  MEMO_Q,
  PARSE_PROMPT,
  pc,
  pcBg,
  fmtN,
  card,
  lbl,
  CLOUD_SYNC_KEYS,
  LOCAL_STORAGE_OWNER_KEY,
  SNAPSHOT_IMPORT_ACTION,
  MAX_HOLDINGS,
  inferHoldingType,
  normalizeNumber,
  isSameNumber,
  isExactDemoHolding,
  stripDemoSeedHoldings,
  holdingHasUserOrigin,
  markUserOwnedHolding,
  DEMO_SEED_CODES,
  getHoldingCodesKey,
  getCurrentUserId,
  save,
  formatResetCountdown,
  formatResetDateTime,
  isQuotaExceeded,
  aiAuthHeaders,
} from "./_freeCheckup/constants";
import {
  useHoldingsMigration,
  useFreeCheckupBootstrap,
  useFetchCalendarEventsRef,
} from "@/hooks/useFreeCheckupBootstrap";
import { fetchAuthoritativeQuotesDetailed } from "@/checkup/lib/authoritativeQuotes";
import { fetchDailyCloseCards } from "@/checkup/lib/closeAuthority";
import { confirmedCloseLabel } from "@/checkup/lib/confirmedClose";
import { latestCompletedTradeDate, closeAuthorityLane } from "@/checkup/lib/marketCalendar";
import { closeAuthorityFingerprint, needsCloseAuthorityRefresh } from "@/checkup/lib/closeAlignment";

import { Logomark } from "@/components/brand";

// #region App() — 主元件（state、effects、JSX 全部 inline；遵守 inline 憲法）
export default function App() {
  const navigate = useNavigate();
  const { isDemo, isReady: authReady, canUpload, hasReachedDailyLimit, startLineLogin, incrementUploadCount, lineProfile, demoData, tier, tierLabel, quota, remainingQuota, periodLabel, refreshQuota, applyQuotaFromResponse, supabaseUser, needsAddFriend } = useCheckupMode();
  const [tab, setTab]     = useState("holdings");
  // Batch C §6.3：「＋ 上傳」不再切 tab，改為 modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const openUploadModal = () => { setUploadModalOpen(true); try { trackRaw('checkup_upload_modal_open'); } catch {} };
  const closeUploadModal = () => setUploadModalOpen(false);
  useEffect(() => { trackRaw('checkup_view', { tab: 'holdings' }); }, []);
  // 配額耗盡採 inline banner（TradeTab L162 / DailyTab）+ toast 提示，
  // 不再使用全螢幕 modal，避免擋住 tab 導航（見 .lovable/plan.md）
  // 每分鐘 tick 一次，重新計算「距離重置」倒數
  const [, setQuotaTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setQuotaTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (tab !== 'daily' || isDemo || !supabaseUser?.id) return;
    refreshQuota?.().catch(() => {});
  }, [tab, isDemo, supabaseUser?.id, refreshQuota]);
  const [ready, setReady] = useState(false);

  // persistent state
  const [holdings,  setHoldings]  = useState(null);
  const [tradeLog,  setTradeLog]  = useState(null);
  const [targets,   setTargets]   = useState(null);

  // upload / memo
  const [img, setImg]           = useState(null);
  const [b64, setB64]           = useState(null);
  const [parsing, setParsing]   = useState(false);
  const [parsed,  setParsed]    = useState(null);
  const [parseErr,setParseErr]  = useState(null);
  // 上傳成功後的摘要：{ added: [{code,name,qty}], updated: [...], at: timestamp }
  const [uploadSummary, setUploadSummary] = useState(null);
  // 解析/同步進度追蹤：{ stage, label, progress(0-100), detail }
  // stage: 'upload' | 'ai' | 'retry' | 'persist' | 'refresh' | 'done' | 'error'
  const [parseStep, setParseStep] = useState(null);
  // 批次解析狀態：{ items: [{id,name,size,previewUrl,b64,status,error,errorDetail}], currentIndex, total, running, cancelled }
  // status: 'pending' | 'parsing' | 'success' | 'failed' | 'cancelled'
  // 持久化：sessionStorage（refresh 後仍能看到 i/N 進度與已完成結果）
  const BATCH_STORAGE_KEY = 'freecheckup-batch-state-v1';
  const [batchState, setBatchState] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(BATCH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.items?.length) return null;
      const items = parsed.items.map((it) => ({
        ...it,
        // blob: URL 無法跨 refresh 存活；用 b64 重建 data URI
        previewUrl: it.b64 ? `data:image/jpeg;base64,${it.b64}` : null,
        // 重新整理時若有「parsing 中」的項目→視為已取消，提示使用者重試
        status: it.status === 'parsing' ? 'cancelled' : it.status,
        error: it.status === 'parsing' ? '頁面重新整理而中斷，可按「重試失敗」' : (it.error || null),
        errorDetail: it.status === 'parsing'
          ? { type: 'interrupted', message: '頁面重新整理而中斷，可按「重試失敗」' }
          : (it.errorDetail || null),
      }));
      return {
        items,
        currentIndex: parsed.currentIndex || 0,
        total: parsed.total || items.length,
        running: false,
        cancelled: items.some((it) => it.status === 'cancelled' || it.status === 'failed'),
        restored: true,
      };
    } catch { return null; }
  });
  const batchCancelRef = useRef(false);
  const batchStateRef = useRef(null);
  useEffect(() => { batchStateRef.current = batchState; }, [batchState]);
  // 自動寫回 sessionStorage（best-effort，超過 quota 時退而保存無 b64 的精簡版）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!batchState || !batchState.items?.length) {
        window.sessionStorage.removeItem(BATCH_STORAGE_KEY);
        return;
      }
      const payload = {
        items: batchState.items.map(({ previewUrl: _pv, ...rest }) => rest),
        currentIndex: batchState.currentIndex,
        total: batchState.total,
      };
      try {
        window.sessionStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // quota exceeded → 移除 b64，至少保留 status/name/error 讓進度可見
        const lite = {
          ...payload,
          items: payload.items.map(({ b64: _b, ...rest }) => rest),
        };
        try { window.sessionStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(lite)); } catch {}
      }
    } catch {}
  }, [batchState]);
  // 報價刷新狀態：{ phase, total, ok, fail, missingNames }
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [dragOver,setDragOver]  = useState(false);
  const [memoStep,setMemoStep]  = useState(0);
  const [memoAns, setMemoAns]   = useState([]);
  const [memoIn,  setMemoIn]    = useState("");
  const [saved,   setSaved]     = useState("");

  // ── Demo 鎖定動作的統一提示（toast + 4 秒後消失） ──
  // 用於：手動編輯持倉、上傳截圖、手動更新股價、刪除/新增、編輯交易日誌
  const showDemoLockToast = useCallback((featureName = '此功能') => {
    setSaved(`這是 DEMO 範例。登入後即可${featureName}`);
    setTimeout(() => setSaved(''), 4000);
  }, []);

  // ── Demo Tab 說明卡（行事曆 / 事件分析 / 收盤分析 / 交易日誌）──
  // 直接 inline 在 FreeCheckup.jsx 內，符合既有 inline 渲染慣例
  // §6.5：DEMO_TAB_NOTICE_COPY 已內化到唯一使用者 ResearchTab（RESEARCH_DEMO_NOTICE）。

  // dashboard UI
  const [sortBy,      setSortBy]      = useState("decision");
  // A2-lite: viewMode / sortMenuOpen 已內化為 HoldingsTab local state（純子元件 UI，不影響 parent memo）
  const [filterType,  setFilterType]  = useState("全部");
  const [showAll,     setShowAll]     = useState(false);
  // D-Perf-R2 (holdings audit 2026-05 第二輪)：viewport 訂閱已下沉到 HoldingsTab
  // 內部，避免 resize tick 觸發 god component 全量 re-render。cardGridCols
  // 不再由 parent 計算與透傳。
  const [expandedNews, setExpandedNews] = useState(new Set());
  const [newsPendingExpanded, setNewsPendingExpanded] = useState(false);
  const [newsVerifyingExpanded, setNewsVerifyingExpanded] = useState(false);
  const [newsPastExpanded, setNewsPastExpanded] = useState(false);
  const [predictingEvents, setPredictingEvents] = useState(false);
  const toggleNews = (id) => setExpandedNews(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const [tpCode, setTpCode] = useState("");
  const [tpFirm, setTpFirm] = useState("");
  const [tpVal,  setTpVal]  = useState("");

  // refresh prices / server sync — 深模組：src/pages/_freeCheckup/useHoldingsSync.js
  // deps 在後續 render 由 syncDepsRef.current 補齊（H / refreshPrices 於下方才宣告）
  const syncDepsRef = useRef({});
  const {
    refreshing, setRefreshing,
    lastUpdate, setLastUpdate,
    rtConnected, setRtConnected,
    cooldownText,
    syncLog, appendLog, downloadSyncLog,
    coverageOpen, setCoverageOpen,
    coverageReport, setCoverageReport,
    backfilling,
    serverSyncing,
    syncError, setSyncError,
    syncCopyState, setSyncCopyState,
    holdingSyncStates, setHoldingSyncStates,
    markCardsSyncing, setCardSyncResult, clearAllCardSync,
    triggerServerSync, runBackfillReport,
    REFRESH_COOLDOWN,
  } = useHoldingsSync(syncDepsRef);


  // Preload knowledge base from cloud (sync into memory once on mount)
  useEffect(() => {
    preloadKnowledgeBase().catch(() => {});
  }, []);


  // daily analysis
  const [analyzing, setAnalyzing]       = useState(false);
  const [analyzeStep, setAnalyzeStep]   = useState("");
  const [dailyReport, setDailyReport]   = useState(null);
  const [analysisHistory, setAnalysisHistory] = useState(null);
  const [newsEvents, setNewsEvents]     = useState(null);
  const [reviewingEvent, setReviewingEvent] = useState(null);
  const [reviewForm, setReviewForm]     = useState({actual:"up",actualNote:"",lessons:""});
  // Phase A2-1: stable callbacks for NewsEventRow memoization
  const reviewFormRef = useRef(reviewForm);
  useEffect(() => { reviewFormRef.current = reviewForm; }, [reviewForm]);
  const stableToggleNews = useCallback((id) => {
    setExpandedNews(prev => {
      const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
    });
  }, []);
  const stableStartReview = useCallback((id) => {
    setReviewingEvent(id);
    setReviewForm({ actual: "up", actualNote: "", lessons: "" });
  }, []);
  const stableCancelReview = useCallback(() => {
    setReviewingEvent(null);
  }, []);
  const stableChangeReview = useCallback((patch) => {
    setReviewForm(prev => ({ ...prev, ...patch }));
  }, []);
  const submitReviewRef = useRef(null);
  const stableSubmitReview = useCallback((id) => {
    submitReviewRef.current?.(id);
  }, []);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent]         = useState({date:"",title:"",detail:"",stocks:"",pred:"up",predReason:""});
  const [reversalConditions, setReversalConditions] = useState(null);
  const [strategyBrain, setStrategyBrain] = useState(null);
  const [cloudSync, setCloudSync]         = useState(false);
  const [calendarEvents, setCalendarEvents] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  // 自動更新狀態徽章：'idle' | 'fetching' | 'throttled' | 'skipped-idempotent' | 'aborted' | 'success' | 'error'
  const [calendarAutoStatus, setCalendarAutoStatus] = useState({ status: 'idle', msg: '' });
  const [predictAutoStatus, setPredictAutoStatus] = useState({ status: 'idle', msg: '' });
  const calendarStatusTimerRef = useRef(null);
  const predictStatusTimerRef = useRef(null);
  // 最近一次失敗錯誤明細：{ message, reason: 'network'|'data'|'server'|'unknown', at: ISOString }
  const [calendarLastError, setCalendarLastError] = useState(null);
  const [predictLastError, setPredictLastError] = useState(null);
  // 收盤分析錯誤：{ code, message, cid, opStartedAt, httpStatus, at }
  const [dailyLastError, setDailyLastError] = useState(null);
  // DEMO 收盤分析模式：'static'（預錄範例）｜'live'（呼叫真實 AI + 知識庫）
  const [demoDailyMode, setDemoDailyMode] = useState(() => {
    try { return localStorage.getItem('pf-demo-daily-mode') === 'live' ? 'live' : 'static'; } catch { return 'static'; }
  });
  useEffect(() => {
    try { localStorage.setItem('pf-demo-daily-mode', demoDailyMode); } catch {}
  }, [demoDailyMode]);
  const dailyLastErrorRef = useRef(null);
  useEffect(() => { dailyLastErrorRef.current = dailyLastError; }, [dailyLastError]);
  // 重試按鈕的瞬時鎖定：點擊後立即為 true，避免在 setAnalyzing 尚未 flush 前重複送出
  const [dailyRetryLocked, setDailyRetryLocked] = useState(false);
  const dailyRetryLockRef = useRef(false);
  // 重試時間軸：每次點擊重試都會新增一筆 { id, attempt, cid, startedAt, endedAt, durationMs, success, code, message, httpStatus }
  const [dailyRetryHistory, setDailyRetryHistory] = useState([]);
  const dailyRetryAttemptRef = useRef(0);
  // 重試後自動展開錯誤摘要：每次重試結束後遞增，觸發 UI 滾動聚焦
  const [dailyErrorFocusKey, setDailyErrorFocusKey] = useState(0);
  const dailyErrorRef = useRef(null);
  // 重試結束後，若仍有錯誤則自動滾動聚焦於錯誤摘要卡
  useEffect(() => {
    if (!dailyErrorFocusKey) return;
    if (!dailyLastError) return;
    const el = dailyErrorRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyErrorFocusKey]);
  // AI 模型嘗試紀錄（debug）：{ source, at, attempts: [{path, model, status, ok, errorBody, errorMessage}], succeededWith }
  const [calendarLastDebug, setCalendarLastDebug] = useState(null);
  const [predictLastDebug, setPredictLastDebug] = useState(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  // 重試計數與冷卻：每連續失敗一次累計，達上限或冷卻期內禁止重試
  const RETRY_MAX = 3;
  const RETRY_COOLDOWN_MS = 15_000;
  const [calendarRetry, setCalendarRetry] = useState({ count: 0, cooldownUntil: 0 });
  const [predictRetry, setPredictRetry] = useState({ count: 0, cooldownUntil: 0 });
  // 更新日誌：記錄手動/自動觸發的時間、狀態、batchKey/requestKey，用於除錯
  // entry: { id, ts, source: 'calendar'|'predict', trigger: 'manual'|'auto', status, key, msg }
  const [updateLog, setUpdateLog] = useState([]);
  const [updateLogOpen, setUpdateLogOpen] = useState(false);
  const updateLogIdRef = useRef(0);
  const pushUpdateLog = (entry) => {
    setUpdateLog(prev => {
      const next = [{
        id: ++updateLogIdRef.current,
        ts: Date.now(),
        ...entry,
      }, ...prev];
      // 保留最近 50 筆
      return next.slice(0, 50);
    });
  };
  // 強制每秒 re-render 以更新冷卻倒數
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const inCooldown = calendarRetry.cooldownUntil > Date.now() || predictRetry.cooldownUntil > Date.now();
    if (!inCooldown) return;
    const t = setInterval(() => setNowTick(n => n + 1), 500);
    return () => clearInterval(t);
  }, [calendarRetry.cooldownUntil, predictRetry.cooldownUntil]);
  // Decision System v6
  const [userOverrides] = useState({});
  // A2-lite: expandedDecision 已內化為 HoldingsTab local state（卡片選取不再污染 parent）
  const [debugMode, setDebugMode] = useState(false);
  // sparkline 資料與失敗代號已下沉到 useSparklines（快取層 = checkupCacheStore）


  // ── 持倉資料庫（Notion 模式）：搜尋 / 篩選 / 排序方向 / Drawer ──
  const [searchQ, setSearchQ] = useState("");
  const [filterDecision, setFilterDecision] = useState(new Set()); // hold/review/exit
  const [filterThesis, setFilterThesis] = useState(new Set());     // intact/weakening/broken
  const [filterUrgency, setFilterUrgency] = useState(new Set());   // now/soon/monitor
  const [filterConflict, setFilterConflict] = useState(new Set()); // conflict/no_conflict
  const [filterPnl, setFilterPnl] = useState(new Set());           // win/loss/flat
  const [filterStrategy, setFilterStrategy] = useState(new Set()); // dynamic
  const [sortDir, setSortDir] = useState("desc");                  // asc / desc
  // legacy Detail Drawer 已移除：持倉卡只走 HoldingsWorkbench -> HoldingsDetailPanel 單一路徑。

  const toggleSetItem = (setter) => (val) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  };
  const clearAllFilters = () => {
    setSearchQ("");
    setFilterDecision(new Set());
    setFilterThesis(new Set());
    setFilterUrgency(new Set());
    setFilterConflict(new Set());
    setFilterPnl(new Set());
    setFilterStrategy(new Set());
  };

  // reset guard — 清除全部後忽略 in-flight 的行事曆回應
  const resetGuardRef = useRef(0);
  // 追蹤是否為使用者主動操作（上傳截圖）造成的持倉變動
  const holdingsChangedByUserRef = useRef(false);

  // ── Calendar 節流與冪等控制 ──
  // - inflightKey：當下正在抓取的 holdingCodes，若相同則略過
  // - lastFetch：{ key, at } 上次成功完成的請求（30 秒內相同 key 視為重複）
  // - controller：保留中斷器，新請求進來會 abort 前一個
  const calendarInflightKeyRef = useRef(null);
  const calendarLastFetchRef = useRef({ key: null, at: 0 });
  const calendarAbortRef = useRef(null);
  const CALENDAR_DEDUP_MS = 30_000;

  // 錯誤分類：根據 Error/HTTP status/訊息內容判斷錯誤類型
  const classifyError = (err, httpStatus) => {
    if (httpStatus) {
      if (httpStatus >= 500) return { reason: 'server', label: '伺服器錯誤' };
      if (httpStatus === 429) return { reason: 'server', label: '請求過於頻繁' };
      if (httpStatus >= 400) return { reason: 'data', label: '資料錯誤' };
    }
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('networkerror')) {
      return { reason: 'network', label: '網路連線錯誤' };
    }
    if (msg.includes('timeout') || msg.includes('aborted')) return { reason: 'network', label: '請求逾時' };
    if (msg.includes('json') || msg.includes('parse')) return { reason: 'data', label: '資料解析錯誤' };
    return { reason: 'unknown', label: '未知錯誤' };
  };

  // 短暫顯示節流/冪等/結果狀態（fetching 持續到完成；其餘 4 秒後回 idle）
  const flashCalendarStatus = (status, msg = '') => {
    setCalendarAutoStatus({ status, msg });
    if (calendarStatusTimerRef.current) clearTimeout(calendarStatusTimerRef.current);
    if (status === 'success') {
      // 成功後重置重試計數與錯誤記錄
      setCalendarRetry({ count: 0, cooldownUntil: 0 });
      setCalendarLastError(null);
    }
    if (status !== 'fetching' && status !== 'idle') {
      calendarStatusTimerRef.current = setTimeout(() => setCalendarAutoStatus({ status: 'idle', msg: '' }), 4000);
    }
  };
  const flashPredictStatus = (status, msg = '') => {
    setPredictAutoStatus({ status, msg });
    if (predictStatusTimerRef.current) clearTimeout(predictStatusTimerRef.current);
    if (status === 'success') {
      setPredictRetry({ count: 0, cooldownUntil: 0 });
      setPredictLastError(null);
    }
    if (status !== 'fetching' && status !== 'idle') {
      predictStatusTimerRef.current = setTimeout(() => setPredictAutoStatus({ status: 'idle', msg: '' }), 4000);
    }
  };

  // 記錄錯誤明細並啟動冷卻；回傳是否仍在可重試範圍
  const recordCalendarError = (err, httpStatus) => {
    const { reason, label } = classifyError(err, httpStatus);
    const message = String(err?.message || err || '').slice(0, 240) || label;
    setCalendarLastError({ message, reason, label, at: new Date().toISOString() });
    setCalendarRetry(prev => {
      const count = prev.count + 1;
      const cooldownUntil = count >= RETRY_MAX
        ? Date.now() + RETRY_COOLDOWN_MS * 4   // 達上限：長冷卻
        : Date.now() + RETRY_COOLDOWN_MS;
      return { count, cooldownUntil };
    });
  };
  const recordPredictError = (err, httpStatus) => {
    const { reason, label } = classifyError(err, httpStatus);
    const message = String(err?.message || err || '').slice(0, 240) || label;
    setPredictLastError({ message, reason, label, at: new Date().toISOString() });
    setPredictRetry(prev => {
      const count = prev.count + 1;
      const cooldownUntil = count >= RETRY_MAX
        ? Date.now() + RETRY_COOLDOWN_MS * 4
        : Date.now() + RETRY_COOLDOWN_MS;
      return { count, cooldownUntil };
    });
  };

  const mapFallbackCodeToStatus = (code) => {
    if (code === 'AI_BILLING_REQUIRED') return 402;
    if (code === 'AI_RATE_LIMITED') return 429;
    if (code === 'AI_AUTH_FAILED') return 401;
    return 503;
  };

  // ── 根據持倉自動產生行事曆事件 ──
  const fetchCalendarEvents = async (holdingsList, guard, existingEvents = [], trigger = 'auto') => {
    if (!holdingsList || holdingsList.length === 0) {
      setCalendarEvents([]);
      save("pf-calendar-v1", { events: [], holdingCodes: "" });
      setCalendarAutoStatus({ status: 'idle', msg: '' });
      pushUpdateLog({ source:'calendar', trigger, status:'skipped', key:'(empty)', msg:'尚無持倉' });
      return;
    }
    const requestKey = holdingsList.map(h => h.code).sort().join(",");
    // 1) 同一個 key 已在飛行中 → 略過（避免併發）
    if (calendarInflightKeyRef.current === requestKey) {
      flashCalendarStatus('skipped-idempotent');
      pushUpdateLog({ source:'calendar', trigger, status:'skipped-idempotent', key:requestKey, msg:'同 key 進行中' });
      return;
    }
    // 2) 30 秒內剛抓過相同 key → 略過（節流）
    const last = calendarLastFetchRef.current;
    if (last.key === requestKey && Date.now() - last.at < CALENDAR_DEDUP_MS) {
      flashCalendarStatus('throttled');
      pushUpdateLog({ source:'calendar', trigger, status:'throttled', key:requestKey, msg:`30s 內已更新` });
      return;
    }
    // 3) 不同 key 但有舊請求飛行中 → 中斷之
    if (calendarAbortRef.current) {
      try { calendarAbortRef.current.abort(); } catch { /* noop */ }
      calendarAbortRef.current = null;
    }
    calendarInflightKeyRef.current = requestKey;
    setCalendarLoading(true);
    setCalendarAutoStatus({ status: 'fetching', msg: '' });
    pushUpdateLog({ source:'calendar', trigger, status:'fetching', key:requestKey, msg:`${holdingsList.length} 檔` });
    // ── DEMO 模式：模擬載入 + 套用 DEMO_CALENDAR，不打 edge function ──
    if (isDemo && trigger !== 'manual') {
      try {
        await simulateSteps([
          { label: '掃描未來重大事件...', min: 800, max: 1400 },
          { label: '比對持股相關性...', min: 700, max: 1200 },
        ], () => {});
        const { DEMO_CALENDAR } = await import("@/checkup/data/demoData");
        const merged = [...DEMO_CALENDAR];
        merged._holdingCodes = holdingsList.map(h => h.code).sort().join(',');
        setCalendarEvents(merged);
        syncCalendarToNews(merged);
        calendarLastFetchRef.current = { key: requestKey, at: Date.now() };
        setCalendarRetry({ count: 0, cooldownUntil: 0 });
        setCalendarLastError(null);
        setCalendarAutoStatus({ status: 'idle', msg: '' });
        pushUpdateLog({ source:'calendar', trigger, status:'success', key:requestKey, msg:'demo 範例資料' });
      } finally {
        if (calendarInflightKeyRef.current === requestKey) calendarInflightKeyRef.current = null;
        setCalendarLoading(false);
      }
      return;
    }
    try {
      const stockList = holdingsList.map(h => `${h.code} ${h.name}`).join("、");
      const today = new Date().toLocaleDateString("zh-TW", { year:"numeric", month:"2-digit", day:"2-digit" }).replace(/\//g, "/");
      const oneYearLater = new Date();
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      const endDate = oneYearLater.toLocaleDateString("zh-TW", { year:"numeric", month:"2-digit", day:"2-digit" }).replace(/\//g, "/");

      const controller = new AbortController();
      calendarAbortRef.current = controller;
      const timer = setTimeout(() => controller.abort(), 300000); // 5 min timeout
      let result;
      let httpStatus = 200;
      try {
        result = await callEdge('checkup-calendar', {
          body: { stocks: stockList, today, endDate, debug: true },
          query: { debug: 1 },
          signal: controller.signal,
          silent: true,
        });
      } catch (err) {
        clearTimeout(timer);
        httpStatus = err?.status || 0;
        // 422/4xx fallback body 也走原本 fallback 流程
        if (err?.body) result = err.body;
        else throw err;
      }
      clearTimeout(timer);
      if (!result) result = {};
      if (result?.debug) {
        setCalendarLastDebug({ source: 'calendar', at: new Date().toISOString(), httpStatus, ...result.debug });
      }
      if (guard !== undefined && guard !== resetGuardRef.current) {
        pushUpdateLog({ source:'calendar', trigger, status:'aborted', key:requestKey, msg:'guard 變更' });
        return;
      }
      if (result?.fallback) {
        const fallbackStatus = mapFallbackCodeToStatus(result.code);
        const fallbackErr = new Error(result.error || '行事曆暫時不可用');
        recordCalendarError(fallbackErr, fallbackStatus);
        flashCalendarStatus('error', result.error || '行事曆暫時不可用');
        pushUpdateLog({ source:'calendar', trigger, status:'error', key:requestKey, msg:result.error || `fallback (${result.code || 'unknown'})` });
        return;
      }
      const text = result.text || result.response || "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const newEvents = JSON.parse(jsonMatch[0]).filter(e => e && e.label);
        // 合併去重：以 label+date 為 key
        const existing = Array.isArray(existingEvents) ? existingEvents : [];
        const seen = new Set(existing.map(e => `${e.label}||${e.date}`));
        const merged = [...existing];
        for (const ne of newEvents) {
          const key = `${ne.label}||${ne.date}`;
          if (!seen.has(key)) { merged.push(ne); seen.add(key); }
        }
        merged.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        const holdingCodes = holdingsList.map(h => h.code).sort().join(",");
        merged._holdingCodes = holdingCodes;
        const saveObj = { events: merged, holdingCodes };
        save("pf-calendar-v1", saveObj);
        setCalendarEvents(merged);
        // 同步到事件分析
        syncCalendarToNews(merged);
      }
      calendarLastFetchRef.current = { key: requestKey, at: Date.now() };
      // 成功：重置重試計數與錯誤
      setCalendarRetry({ count: 0, cooldownUntil: 0 });
      setCalendarLastError(null);
      setCalendarAutoStatus({ status: 'idle', msg: '' });
      pushUpdateLog({ source:'calendar', trigger, status:'success', key:requestKey, msg:'完成' });
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.error("Calendar fetch error:", e);
        recordCalendarError(e);
        const { label } = classifyError(e);
        flashCalendarStatus('error', label);
        pushUpdateLog({ source:'calendar', trigger, status:'error', key:requestKey, msg:label });
        throw e;
      } else {
        flashCalendarStatus('aborted');
        pushUpdateLog({ source:'calendar', trigger, status:'aborted', key:requestKey, msg:'AbortError' });
      }
    } finally {
      // 只有當前 key 還是這次請求的 key 才清除（避免被新請求覆寫後誤清）
      if (calendarInflightKeyRef.current === requestKey) {
        calendarInflightKeyRef.current = null;
      }
      if (calendarAbortRef.current && calendarAbortRef.current.signal.aborted === false) {
        // 保留：可能已被新請求覆寫，不主動清
      }
      setCalendarLoading(false);
    }
  };

  // ── 將行事曆事件自動同步至事件分析 ──────────────────────────────
  // 邏輯抽至 src/checkup/lib/calendarSync.js（含單元測試）
  const syncCalendarToNews = (calEvents) => {
    if (!calEvents || !Array.isArray(calEvents)) return;
    setNewsEvents(prev => mergeCalendarToNewsEvents(prev, calEvents));
  };

  // boot
  // 一次性清除所有舊版寫死持倉快取（v1 遷移標記）
  // A1 bootstrap 重構：migrate + cloud-first hydration 已抽出至 useFreeCheckupBootstrap
  useHoldingsMigration();
  const fetchCalendarEventsRef = useFetchCalendarEventsRef(fetchCalendarEvents);
  useFreeCheckupBootstrap({
    authReady,
    isDemo,
    resetGuardRef,
    fetchCalendarEventsRef,
    setters: {
      setHoldings, setTradeLog, setTargets,
      setNewsEvents, setAnalysisHistory, setReversalConditions,
      setStrategyBrain, setCalendarEvents, setReady, setCloudSync,
      setDailyReport,
    },
  });

  // dev-only：追蹤 holdings.length 變化（N→0 / 0→N），不包裝 setter、不改資料流
  const prevHoldingsLenRef = useRef(null);
  useEffect(() => {
    try {
      if (!import.meta.env?.DEV) return;
      if (typeof window === "undefined") return;
      if (!window.location?.pathname?.startsWith("/holding-checkup")) return;
      const cur = Array.isArray(holdings) ? holdings.length : (holdings == null ? null : 0);
      const prev = prevHoldingsLenRef.current;
      if (prev !== cur && (prev === 20 || cur === 0 || prev === 0 || cur >= 20)) {
        let hasResetFlag = false;
        try {
          hasResetFlag = !!(sessionStorage.getItem("pf-reset-flag") || localStorage.getItem("pf-reset-flag"));
        } catch {}
        console.log("[checkup-holdings]", { from: prev, to: cur, isDemo, ready, authReady, tab, hasResetFlag });
      }
      prevHoldingsLenRef.current = cur;
    } catch {}
  }, [holdings, isDemo, ready, authReady, tab]);


  // auto-save
  // 雲端 upsert debounce + 錯誤處理（避免快速操作時觸發過多請求）
  const cloudHoldingsTimerRef = useRef(null);
  const cloudHoldingsErrorShownRef = useRef(false);
  useEffect(() => {
    if (!(ready && holdings && !isDemo)) return;
    // 寫雲端 / 本機前一律 strip demo seed，避免任何 race / realtime 將 seed 個股洗回雲端
    const cleanHoldings = stripDemoSeedHoldings(holdings);
    save("pf-holdings-v2", cleanHoldings);
    const uid = getCurrentUserId();
    if (!uid) return;
    if (cloudHoldingsTimerRef.current) clearTimeout(cloudHoldingsTimerRef.current);
    cloudHoldingsTimerRef.current = setTimeout(async () => {
      try {
        const codes = cleanHoldings.map(h => `${h.code} ${h.name}`).join("、");
        const codesKey = cleanHoldings.map(h => h.code).sort().join(",");
        const { error } = await supabase
          .from("checkup_storage")
          .upsert({ user_id: uid, key: "pf-calendar-holdings", data: { stocks: codes, holdingCodes: codesKey } }, { onConflict: "user_id,key" });
        if (error) throw error;
        cloudHoldingsErrorShownRef.current = false;
      } catch (e) {
        console.error("[cloud-sync] pf-holdings-v2 upsert failed:", e);
        if (!cloudHoldingsErrorShownRef.current) {
          cloudHoldingsErrorShownRef.current = true;
          toast.error("持倉雲端同步失敗，僅保存於本機");
        }
      }
    }, 800);
    return () => {
      if (cloudHoldingsTimerRef.current) clearTimeout(cloudHoldingsTimerRef.current);
    };
  }, [holdings, ready, isDemo, getCurrentUserId()]);

  // ── Realtime：訂閱 current_prices 變化，後端 cron 寫入新價格時自動更新畫面 ──
  // 用 holdings code 字串作 deps，避免每次 reference 變動就重訂閱
  const _holdingsCodesKey = useMemo(
    () => (holdings || []).map(h => h.code).filter(Boolean).sort().join(','),
    [holdings]
  );
  useEffect(() => {
    if (isDemo) { setRtConnected(false); return; } // demo 模式不訂閱
    if (!_holdingsCodesKey) { setRtConnected(false); return; }
    const codes = _holdingsCodesKey.split(',');
    const channel = supabase
      .channel('current-prices-fc')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'current_prices',
        filter: `symbol=in.(${codes.join(',')})`,
      }, (payload) => {
        const row = payload.new;
        if (!row || !row.symbol || !(Number(row.price) > 0)) return;
        setHoldings(prev => (prev || []).map(h => {
          if (h.code !== row.symbol) return h;
          // 防 demo seed 洗白：若是 seed code 且該持倉沒有任何使用者來源標記，跳過 realtime 寫入，
          // 避免價格被更新後 isExactDemoHolding 判 false、永久殘留於正式持倉。
          if (DEMO_SEED_CODES.has(h.code) && !holdingHasUserOrigin(h)) return h;
          const price = Number(row.price);
          const { value, pnl, pct } = calcPnlWithNet(h, price);
          return {
            ...h,
            price,
            value, pnl, pct,
            priceSource: 'realtime',
            priceUpdatedAt: row.pushed_at || new Date().toISOString(),
            priceError: null,
          };
        }));
        setLastUpdate(new Date());
      })
      .subscribe((status) => {
        // status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
        setRtConnected(status === 'SUBSCRIBED');
      });
    return () => { setRtConnected(false); supabase.removeChannel(channel); };
  }, [_holdingsCodesKey, isDemo]);

  // Realtime：訂閱使用者自己的背景分析 job 狀態（完成 / 失敗時提示）
  useEffect(() => {
    if (isDemo) return;
    const uid = getCurrentUserId();
    if (!uid) return;
    const ch = supabase
      .channel(`checkup-jobs-${uid}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'checkup_analysis_jobs',
        filter: `user_id=eq.${uid}`,
      }, (payload) => {
        // Realtime payload 僅含 id/user_id/status/error_text/finished_at
        // （publication 已縮欄位避免敏感資料外洩；詳細 result_summary 需 fetch）
        const row = payload?.new;
        if (!row) return;
        if (row.status === 'done') {
          toast.success('📊 背景收盤分析完成，可重新整理頁面檢視', { duration: 8000 });
        } else if (row.status === 'failed') {
          toast.error(`背景收盤分析失敗：${row.error_text || '請重試'}`, { duration: 8000 });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isDemo]);

  // Deep link: ?job=<id> → 載入完成的背景 job 結果並以最小 dailyReport 呈現
  useEffect(() => {
    if (isDemo) return;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const jobId = url.searchParams.get('job');
    if (!jobId) return;
    const uid = getCurrentUserId();
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: job } = await supabase
          .from('checkup_analysis_jobs')
          .select('id, status, result_summary, raw_responses, holdings_snapshot, finished_at, error_text, user_id')
          .eq('id', jobId)
          .maybeSingle();
        if (cancelled || !job || job.user_id !== uid) return;
        if (job.status === 'failed') {
          toast.error(`背景分析失敗：${job.error_text || '請重試'}`, { duration: 8000 });
          return;
        }
        if (job.status !== 'done') {
          toast.info('該背景分析仍在進行中，完成後將通知您', { duration: 6000 });
          return;
        }
        const aiInsight = job?.result_summary?.ai_insight || job?.raw_responses?.main?.text || '';
        const brainRaw = job?.result_summary?.brain_raw || null;
        const eventAssessments = job?.result_summary?.event_assessments || [];
        const snap = Array.isArray(job.holdings_snapshot) ? job.holdings_snapshot : [];
        const changes = snap.map((h) => ({
          code: String(h?.code || ''),
          name: String(h?.name || h?.code || ''),
          price: Number(h?.price) || 0,
          cost: Number(h?.cost) || 0,
          qty: Number(h?.qty) || 0,
          todayPnl: 0,
          changePct: 0,
          returnPct: (Number(h?.price) && Number(h?.cost)) ? ((Number(h.price) - Number(h.cost)) / Number(h.cost)) * 100 : 0,
        }));
        setDailyReport({
          id: Date.now(),
          date: (job.finished_at || new Date().toISOString()).slice(0, 10).replace(/-/g, '/'),
          time: new Date(job.finished_at || Date.now()).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
          totalTodayPnl: Number(job?.result_summary?.total_pnl) || 0,
          changes,
          anomalies: [],
          eventCorrelations: [],
          needsReview: [],
          autoVerified: [],
          aiInsight,
          eventAssessments,
          fromBackgroundJob: true,
        });
        // 將 worker 解析出的策略大腦 raw 更新到 state 並寫回雲端
        if (brainRaw && brainRaw.rules) {
          try {
            setStrategyBrain(brainRaw);
            await supabase.functions.invoke('checkup-brain', {
              body: { action: 'save-brain', data: brainRaw },
            });
          } catch (e) {
            console.warn('[deep-link job] brain persist failed', e);
          }
        }
        toast.success('已載入背景分析結果', { duration: 4000 });

        // 清掉 query string 避免重複載入
        url.searchParams.delete('job');
        window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash);
      } catch (e) {
        console.warn('[deep-link job] failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);
  // tradeLog 存到 Supabase — 改用「scoped delete + insert」並加 debounce/錯誤通知
  // 重要：原本 .delete().neq() 沒帶 user_id 篩選，僅靠 RLS 保護；改為明確 .eq('user_id', ...) 雙保險
  const cloudTradeLogTimerRef = useRef(null);
  const cloudTradeLogErrorShownRef = useRef(false);
  const saveTradeLogToCloud = async (logs) => {
    if (!logs || !getCurrentUserId()) return;
    const uid = getCurrentUserId();
    try {
      // 不帶客端 id：永遠讓 DB 用 gen_random_uuid() 產 id，
      // 避免跨帳號（過往 leak 殘留）的 UUID 撞到他人 row 造成 PK unique violation。
      const rows = logs.map(l => ({
        user_id: uid,
        trade_date: l.date || null,
        trade_time: l.time || null,
        action: l.action || null,
        code: l.code || null,
        name: l.name || null,
        qty: l.qty != null ? l.qty : null,
        price: l.price != null ? l.price : null,
        qa: l.qa || [],
      }));
      // 僅刪除自己的資料（RLS + 顯式 user_id 雙重保險）
      const { error: delErr } = await supabase
        .from("checkup_trade_memos")
        .delete()
        .eq("user_id", uid);
      if (delErr) throw delErr;
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("checkup_trade_memos").insert(rows);
        if (insErr) throw insErr;
      }
      cloudTradeLogErrorShownRef.current = false;
    } catch (e) {
      console.error("[cloud-sync] trade memos save failed:", e);
      if (!cloudTradeLogErrorShownRef.current) {
        cloudTradeLogErrorShownRef.current = true;
        toast.error("交易紀錄雲端同步失敗，僅保存於本機");
      }
    }
  };
  useEffect(() => {
    if (!(ready && tradeLog && !isDemo)) return;
    save("pf-log-v2", tradeLog);
    if (cloudTradeLogTimerRef.current) clearTimeout(cloudTradeLogTimerRef.current);
    cloudTradeLogTimerRef.current = setTimeout(() => saveTradeLogToCloud(tradeLog), 800);
    return () => {
      if (cloudTradeLogTimerRef.current) clearTimeout(cloudTradeLogTimerRef.current);
    };
  }, [tradeLog, ready, isDemo]);
  useEffect(() => { if (ready && targets && !isDemo)  save("pf-targets-v1",  targets);  }, [targets, ready, isDemo]);
  useEffect(() => { if (ready && newsEvents && !isDemo) save("pf-news-events-v1", newsEvents); }, [newsEvents, ready, isDemo]);

  // ── 7天內事件自動觸發AI預測 → 移入「待驗證」 ──
  const predictedIdsRef = useRef(new Set());
  const predictBatchInflightRef = useRef(null);
  const predictLastRunRef = useRef(0);
  const PREDICT_MIN_INTERVAL_MS = 30_000;

  // 共用：執行一次預測（force=true 會繞過節流並重置已嘗試清單）
  const runPredictEvents = (force = false) => {
    const trigger = force ? 'manual' : 'auto';
    // demo 模式允許測試（不需登入，走模擬路徑）；非 demo 才要求登入
    if (!isDemo && !supabaseUser?.id) {
      if (force) {
        flashPredictStatus('error', '請先登入後使用事件預測');
        pushUpdateLog({ source:'predict', trigger, status:'blocked-auth', key:'(auth)', msg:'未登入，改走登入引導' });
        startLineLogin?.();
      }
      return;
    }
    // 配額已耗盡時，背景自動觸發直接跳過，避免每分鐘對伺服器送 429（手動 force 仍走原路給明確錯誤）
    if (!force && !isDemo && hasReachedDailyLimit) {
      return;
    }
    // 重試上限與冷卻檢查（僅作用於 force 觸發；自動觸發不受限）
    if (force) {
      const now = Date.now();
      if (predictRetry.cooldownUntil > now) {
        const sec = Math.ceil((predictRetry.cooldownUntil - now) / 1000);
        const reachedMax = predictRetry.count >= RETRY_MAX;
        const msg = reachedMax
          ? `已達重試上限 ${RETRY_MAX} 次，請 ${sec}s 後再試`
          : `冷卻中，請 ${sec}s 後再試`;
        flashPredictStatus('error', msg);
        pushUpdateLog({ source:'predict', trigger, status:'cooldown', key:'(n/a)', msg });
        return;
      }
    }
    if (!ready || !newsEvents || newsEvents.length === 0) {
      if (force) {
        flashPredictStatus('error', '尚無事件可預測');
        pushUpdateLog({ source:'predict', trigger, status:'skipped', key:'(empty)', msg:'尚無事件' });
      }
      return;
    }
    if (predictingEvents) {
      if (force) flashPredictStatus('skipped-idempotent');
      pushUpdateLog({ source:'predict', trigger, status:'skipped-idempotent', key:'(inflight)', msg:'進行中' });
      return;
    }
    if (!force && Date.now() - predictLastRunRef.current < PREDICT_MIN_INTERVAL_MS) {
      flashPredictStatus('throttled');
      pushUpdateLog({ source:'predict', trigger, status:'throttled', key:'(n/a)', msg:'30s 內已執行' });
      return;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    if (force) predictedIdsRef.current = new Set();

    const needsPrediction = newsEvents.filter(e => {
      if (e.status !== "pending") return false;
      if (predictedIdsRef.current.has(e.id)) return false;
      if (!e.date || !e.date.match(/^\d{4}\/\d{2}\/\d{2}/)) return false;
      const evDate = new Date(e.date.replace(/\//g, "-"));
      evDate.setHours(0, 0, 0, 0);
      return evDate >= now && evDate <= sevenDaysLater;
    });

    if (needsPrediction.length === 0) {
      if (force) {
        flashPredictStatus('error', '7 天內無待預測事件');
        pushUpdateLog({ source:'predict', trigger, status:'skipped', key:'(empty-7d)', msg:'7 天內無待預測' });
      }
      return;
    }

    const batchKey = needsPrediction.map(e => e.id).sort().join("|");
    if (predictBatchInflightRef.current === batchKey) {
      flashPredictStatus('skipped-idempotent');
      pushUpdateLog({ source:'predict', trigger, status:'skipped-idempotent', key:batchKey, msg:'同 batch 進行中' });
      return;
    }
    predictBatchInflightRef.current = batchKey;
    needsPrediction.forEach(e => predictedIdsRef.current.add(e.id));
    predictLastRunRef.current = Date.now();

    setPredictingEvents(true);
    setPredictAutoStatus({ status: 'fetching', msg: '' });
    pushUpdateLog({ source:'predict', trigger, status:'fetching', key:batchKey, msg:`${needsPrediction.length} 件` });
    (async () => {
      // ── DEMO 模式：模擬延遲 + 用既有 demo 事件的 pred/predReason 自填 ──
      if (isDemo) {
        try {
          setPredictAutoStatus({ status: 'fetching', msg: 'AI 預測事件影響中...' });
          await demoDelay(1800, 2800);
          setNewsEvents(prev => {
            const arr = [...(prev || [])];
            needsPrediction.forEach((e) => {
              const idx = arr.findIndex(x => x.id === e.id);
              if (idx < 0) return;
              arr[idx] = {
                ...arr[idx],
                status: 'verifying',
                pred: arr[idx].pred || 'neutral',
                predReason: arr[idx].predReason || 'AI 範例預測（DEMO）',
              };
            });
            return arr;
          });
          flashPredictStatus('success', `已預測 ${needsPrediction.length} 件（DEMO）`);
          pushUpdateLog({ source:'predict', trigger, status:'success', key:batchKey, msg:`demo ${needsPrediction.length} 件` });
        } finally {
          setPredictingEvents(false);
          if (predictBatchInflightRef.current === batchKey) predictBatchInflightRef.current = null;
        }
        return;
      }
      try {
        let data = null;
        try {
          data = await callEdge('checkup-predict-events', {
            body: {
              events: needsPrediction.map((e, i) => ({
                index: i + 1,
                date: e.date,
                title: e.title,
                detail: e.detail,
                stocks: e.stocks,
              })),
              holdings: holdings || [],
              debug: true,
            },
            query: { debug: 1 },
            silent: true,
          });
        } catch (err) {
          const status = err?.status || 0;
          const body = err?.body || null;
          const dataCode = body?.code || body?.error_code || body?.error?.code;
          const dataMsg = String(body?.error || body?.message || "");
          if (status === 429 && (dataCode === 'QUOTA_EXCEEDED' || dataMsg.includes('QUOTA_EXCEEDED'))) {
            // 背景自動觸發配額用盡：完全不打擾 UI（用戶沒按任何鍵），只 refresh quota
            try { await refreshQuota?.(); } catch {}
            needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
            console.warn('[predict] background QUOTA_EXCEEDED, silenced');
            setPredictingEvents(false);
            setPredictAutoStatus({ status: 'idle', msg: '' });
            return;
          }
          console.error("Predict events failed:", status, body || err);
          needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
          recordPredictError(err, status);
          const { label } = classifyError(err, status);
          flashPredictStatus('error', `${label}${status ? `（${status}）` : ''}`);
          pushUpdateLog({ source:'predict', trigger, status:'error', key:batchKey, msg: `${label}${status ? ` (${status})` : ''}` });
          return;
        }
        if (data?.debug) {
          setPredictLastDebug({ source: 'predict', at: new Date().toISOString(), httpStatus: 200, ...data.debug });
        }
        if (data?.fallback) {
          needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
          const fallbackStatus = mapFallbackCodeToStatus(data.code);
          const fallbackErr = new Error(data.error || '事件預測暫時不可用');
          recordPredictError(fallbackErr, fallbackStatus);
          flashPredictStatus('error', data.error || '事件預測暫時不可用');
          pushUpdateLog({ source:'predict', trigger, status:'error', key:batchKey, msg:data.error || `fallback (${data.code || 'unknown'})` });
          return;
        }
        if (data?.gated) {
          // Gate 規則命中（免費永久停 / 付費視窗外 / 付費今日已用）
          needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
          const gateMsg = data.message || '事件預測目前無法執行';
          try { toast.error(gateMsg); } catch {}
          flashPredictStatus('error', gateMsg);
          pushUpdateLog({ source:'predict', trigger, status:'error', key:batchKey, msg: `gated:${data.code || 'UNKNOWN'}` });
          return;
        }
        if (data?.quota) { try { applyQuotaFromResponse?.(data); } catch {} }
        const preds = data?.predictions || [];

        setNewsEvents(prev => {
          const arr = [...(prev || [])];
          needsPrediction.forEach((e, i) => {
            const idx = arr.findIndex(x => x.id === e.id);
            if (idx < 0) return;
            const p = preds.find(pp => pp.index === i + 1);
            arr[idx] = {
              ...arr[idx],
              status: "verifying",
              pred: p?.pred || "neutral",
              predReason: p?.predReason || "AI 自動預測",
            };
          });
          return arr;
        });
        flashPredictStatus('success', `已預測 ${needsPrediction.length} 件`);
        pushUpdateLog({ source:'predict', trigger, status:'success', key:batchKey, msg:`已預測 ${needsPrediction.length} 件` });
      } catch (err) {
        console.error("Predict events error:", err);
        needsPrediction.forEach(e => predictedIdsRef.current.delete(e.id));
        recordPredictError(err);
        const { label } = classifyError(err);
        flashPredictStatus('error', label);
        pushUpdateLog({ source:'predict', trigger, status:'error', key:batchKey, msg:label });
      } finally {
        setPredictingEvents(false);
        if (predictBatchInflightRef.current === batchKey) {
          predictBatchInflightRef.current = null;
        }
      }
    })();
  };

  // 持倉代碼字串作為穩定依賴，避免 holdings array reference 變動觸發過多預測
  const holdingsCodesKey = useMemo(
    () => (holdings || []).map(h => h.code).sort().join(","),
    [holdings]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runPredictEvents(false); }, [newsEvents, ready, holdingsCodesKey]);

  // 手動刷新行事曆（繞過 30 秒節流，但保留 inflight 冪等保護）
  const manualRefreshCalendar = async () => {
    // 重試上限與冷卻檢查
    const now = Date.now();
    if (calendarRetry.cooldownUntil > now) {
      const sec = Math.ceil((calendarRetry.cooldownUntil - now) / 1000);
      const reachedMax = calendarRetry.count >= RETRY_MAX;
      flashCalendarStatus('error', reachedMax
        ? `已達重試上限 ${RETRY_MAX} 次，請 ${sec}s 後再試`
        : `冷卻中，請 ${sec}s 後再試`);
      return;
    }
    if (!holdings || holdings.length === 0) {
      flashCalendarStatus('error', '尚無持倉');
      return;
    }
    if (calendarLoading) {
      flashCalendarStatus('skipped-idempotent');
      return;
    }
    calendarLastFetchRef.current = { key: null, at: 0 };
    try {
      await fetchCalendarEvents(holdings, resetGuardRef.current, calendarEvents || [], 'manual');
      flashCalendarStatus('success', '行事曆已更新');
    } catch {
      // fetchCalendarEvents 內部已 recordCalendarError + flash error
    }
  };

  useEffect(() => { if (ready && analysisHistory) save("pf-analysis-history-v1", analysisHistory); }, [analysisHistory, ready]);
  useEffect(() => { if (ready && reversalConditions) save("pf-reversal-v1", reversalConditions); }, [reversalConditions, ready]);
  useEffect(() => { if (ready && strategyBrain) save("pf-brain-v1", strategyBrain); }, [strategyBrain, ready]);
  useEffect(() => {
    if (ready && calendarEvents) {
      const saveObj = {
        events: calendarEvents,
        holdingCodes: calendarEvents._holdingCodes || "",
      };
      save("pf-calendar-v1", saveObj);
    }
  }, [calendarEvents, ready]);

  // 持倉組合（代碼集合）變動時自動重新抓取行事曆
  // 原本以 holdingsChangedByUserRef 旗標判斷僅在「截圖上傳」觸發，導致手動編輯/刪除/清空持倉時行事曆未跟著更新
  // 改用 codes 字串比對 prevCodes，價格刷新不會觸發（codes 不變），但任何組合變動皆會觸發
  useEffect(() => {
    if (!ready) return;
    const codes = holdingsCodesKey;
    if (!codes) {
      setCalendarEvents([]);
      return;
    }
    const prevCodes = calendarEvents?._holdingCodes || "";
    if (codes !== prevCodes) {
      // 重置舊有的「使用者旗標」以保持向後相容（仍允許截圖路徑顯式設置）
      holdingsChangedByUserRef.current = false;
      fetchCalendarEvents(holdings, resetGuardRef.current, calendarEvents || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsCodesKey, ready]);
  // B-P2 (holdings audit 2026-05): 以 value-key 穩定 H reference。
  // applyMarketQuotesToHoldings / mergeTradeIntoHoldings 內部恆 spread 新陣列，
  // 即使 quote tick 後值未變，holdings reference 仍會抖動 → 下游 9 個 useMemo 全失效。
  // 此處用 code|qty|price|cost hash，值未變時回傳同一 reference。
  // G-Coverage: 抽到 @/checkup/lib/holdingsSort
  const holdingsValueKey = useMemo(() => holdingsValueKeyShort(holdings), [holdings]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const H = useMemo(() => holdings || EMPTY_HOLDINGS, [holdingsValueKey]);

  const totalVal  = H.reduce((s,h)=>s+h.value,0);
  const totalCost = H.reduce((s,h)=> s + (h.totalCost != null ? h.totalCost : h.cost * h.qty), 0);
  const totalPnl  = H.reduce((s,h)=>s+h.pnl,0);
  const retPct    = totalCost>0 ? totalPnl/totalCost*100 : 0;
  const holdingCodes = new Set(H.map(h => h.code));
  const CE = Array.isArray(calendarEvents) ? calendarEvents : [];
  // Match today's date against calendar events (YYYY/MM/DD format)
  const todayStr = new Date().toLocaleDateString("zh-TW", { year:"numeric", month:"2-digit", day:"2-digit" }).replace(/\//g, "/");
  const todayEvents = CE.filter(e => e.date === todayStr);
  const urgentCount = todayEvents.length;

  // Decision System v6: compute decisions for all holding codes
  const normalizedEvents = useMemo(() =>
    (Array.isArray(newsEvents) ? newsEvents : []).map(e => normalizeEventRecord(e)).filter(Boolean),
    [newsEvents]
  );
  // P1+P12: decisionsMap 只依賴 code 列表（穩定字串）
  // buildDecision(code, events, overrides, now) 不看報價，所以 H 變動但 codes 不變時不重算決策
  //
  // A2/A3（holdings audit 2026-05）：在此一次預算
  //   - priority（4 階決策優先度）→ 排序時純讀數字，無需 priorityOf wrapper
  //   - lastTouchedAt（決策更新 + 相關事件最新時間）→ filteredSortedList 不再依賴 normalizedEvents
  // G-Coverage: URGENCY_RANK / CONF_RANK 抽到 @/checkup/lib/holdingsSort（保留 inline 註解：值未變更）

  const decisionsMap = useMemo(() => {
    const map = {};
    const now = new Date();
    const codes = holdingsCodesKey ? holdingsCodesKey.split(',').filter(Boolean) : [];
    // 預先按 code 索引事件，O(events) → O(events) 而非 O(holdings × events)
    const eventTimeByCode = {};
    for (const e of normalizedEvents) {
      const t = e.occurredAt ? new Date(e.occurredAt).getTime() : 0;
      if (!t) continue;
      for (const c of (e.relatedCodes || [])) {
        if (!eventTimeByCode[c] || t > eventTimeByCode[c]) eventTimeByCode[c] = t;
      }
    }
    codes.forEach(code => {
      const dec = buildDecision(code, normalizedEvents, userOverrides, now);
      // Phase 2.5 4 階優先度（原 priorityOf）
      let priority = 5;
      if (dec) {
        if (dec.actionType === 'exit') priority = 0;
        else if (dec.actionType === 'review') priority = 1;
        else if (dec.urgency === 'now' || dec.hasConflict) priority = 2;
        else if (dec.urgency === 'soon') priority = 3;
        else if (dec.thesisState === 'weakening') priority = 4;
      }
      const decTime = dec?.lastUpdatedAt ? new Date(dec.lastUpdatedAt).getTime() : 0;
      const evtTime = eventTimeByCode[code] || 0;
      // lastTouchedAt 不含 priceUpdatedAt（那是 per-tick，排序時再合併）
      map[code] = {
        ...dec,
        priority,
        lastTouchedAt: Math.max(decTime, evtTime),
      };
    });
    return map;
  }, [holdingsCodesKey, normalizedEvents, userOverrides]);


  // ── 持倉資料庫：篩選 + 排序 ──
  // E-Maint-R1 (holdings audit 2026-05 第二輪)：
  //   strategyOptions / actionPriorityItems / displayed / variantsMap /
  //   orderedDisplayed / firstFeatureCode 已下沉到 useHoldingsDerivations
  //   （在 HoldingsTab 內 call）。父層只保留下游其他 region 仍會用到的：
  //     - globalSortedList / globalPriorityList → drawer source + HoldingsTab prop
  //     - exitList / reviewList / upcomingList   → KPI 計數 + drawer source

  // 排序時用：取 dec.lastTouchedAt 與 h.priceUpdatedAt 中的較新
  const getUpdatedAt = (h, dec) => {
    const a = dec?.lastTouchedAt || 0;
    const b = h.priceUpdatedAt ? new Date(h.priceUpdatedAt).getTime() : 0;
    return Math.max(a, b);
  };

  // A2：compareByPriority 只依賴 decisionsMap（已內含 priority），不再 wrap priorityOf
  // A2 + G-Coverage：compareByPriority 抽到 @/checkup/lib/holdingsSort 以供 unit test
  const compareByPriority = useMemo(() => makeCompareByPriority(decisionsMap), [decisionsMap]);


  // 全局優先排序（不受 filter 影響）
  const globalSortedList = useMemo(() => {
    return [...H].sort(compareByPriority);
  }, [H, compareByPriority]);

  const globalPriorityList = useMemo(
    () => globalSortedList.filter(h => (decisionsMap[h.code]?.priority ?? 5) <= 4).slice(0, 3),
    [globalSortedList, decisionsMap]
  );


  const exitList = useMemo(
    () => globalSortedList.filter(h => decisionsMap[h.code]?.actionType === 'exit'),
    [globalSortedList, decisionsMap]
  );
  const reviewList = useMemo(
    () => globalSortedList.filter(h => {
      const d = decisionsMap[h.code];
      return d?.actionType === 'review' || d?.hasConflict;
    }),
    [globalSortedList, decisionsMap]
  );
  const upcomingList = useMemo(
    () => globalSortedList.filter(h => {
      const d = decisionsMap[h.code];
      if (!d) return false;
      if (d.actionType === 'exit' || d.actionType === 'review') return false;
      return d.urgency === 'now' || d.urgency === 'soon';
    }),
    [globalSortedList, decisionsMap]
  );

  // 過濾（searchQ 用 useDeferredValue 延遲，避免每次 keystroke 重算 H × filters × sort）
  const deferredSearchQ = useDeferredValue(searchQ);
  const filteredSortedList = useMemo(() => {
    const tokens = deferredSearchQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matchSearch = (h) => {
      if (!tokens.length) return true;
      const meta = STOCK_META[h.code] || {};
      const hay = [
        h.code, h.name,
        meta.strategy, meta.industry, meta.position, meta.leader,
        ...(Array.isArray(meta.themes) ? meta.themes : []),
      ].filter(Boolean).join(" ").toLowerCase();
      return tokens.every(t => hay.includes(t));
    };
    const list = H.filter(h => {
      if (!matchSearch(h)) return false;
      const dec = decisionsMap[h.code];
      if (filterDecision.size && !filterDecision.has(dec?.actionType || "hold")) return false;
      if (filterThesis.size && !filterThesis.has(dec?.thesisState || "intact")) return false;
      if (filterUrgency.size && !filterUrgency.has(dec?.urgency || "monitor")) return false;
      if (filterConflict.size) {
        const key = dec?.hasConflict ? "conflict" : "no_conflict";
        if (!filterConflict.has(key)) return false;
      }
      if (filterPnl.size) {
        const key = h.pnl > 0 ? "win" : h.pnl < 0 ? "loss" : "flat";
        if (!filterPnl.has(key)) return false;
      }
      if (filterStrategy.size) {
        const s = STOCK_META[h.code]?.strategy;
        if (!s || !filterStrategy.has(s)) return false;
      }
      return true;
    });

    const dirMul = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortBy === "decision") {
        // 決策優先（4 階）：desc=最緊急在前，asc=反向
        return compareByPriority(a, b) * (sortDir === "asc" ? -1 : 1);
      }
      if (sortBy === "value")  return (b.value - a.value) * dirMul;
      if (sortBy === "pnl")    return (b.pnl - a.pnl) * dirMul;
      if (sortBy === "pct")    return (b.pct - a.pct) * dirMul;
      if (sortBy === "urgency") {
        const ra = URGENCY_RANK[decisionsMap[a.code]?.urgency] || 0;
        const rb = URGENCY_RANK[decisionsMap[b.code]?.urgency] || 0;
        return (rb - ra) * dirMul;
      }
      if (sortBy === "confidence") {
        const ra = CONF_RANK[decisionsMap[a.code]?.confidence] || 0;
        const rb = CONF_RANK[decisionsMap[b.code]?.confidence] || 0;
        return (rb - ra) * dirMul;
      }
      if (sortBy === "updated") {
        return (getUpdatedAt(b, decisionsMap[b.code]) - getUpdatedAt(a, decisionsMap[a.code])) * dirMul;
      }
      return 0;
    });
    return list;
    // A3：normalizedEvents 已預算進 decisionsMap.lastTouchedAt，從此處 deps 移除
  }, [H, deferredSearchQ, filterDecision, filterThesis, filterUrgency, filterConflict, filterPnl, filterStrategy, sortBy, sortDir, decisionsMap, compareByPriority]);

  // E-Maint-R1: sorted / displayed / variantsMap / orderedDisplayed / firstFeatureCode
  // 已下沉至 useHoldingsDerivations（在 HoldingsTab 內 call）。
  // 父層改用 filteredSortedList 即可。

  // A2-lite: handleHoldingCardSelect 已內化為 HoldingsTab local（搭配 expandedDecision）。
  // legacy drawer open callback 保留為 undefined；HoldingsWorkbench 會 fallback 到新版 DetailPanel。
  const top5 = [...H].sort((a,b)=>b.value-a.value).slice(0,5);
  const topColors = [C.blue, C.amber, C.lavender, C.olive, C.teal];
  // A4：winnersCount 只用於 HoldingsHero（4 欄 KPI / win rate）；
  // losers 仍是陣列（HoldingsReversalSection 需明細）
  const winnersCount = useMemo(() => H.filter(h=>h.pnl>0).length, [H]);
  const losers  = useMemo(() => H.filter(h=>h.pnl<0).sort((a,b)=>a.pct-b.pct), [H]);

  const filteredEvents = filterType==="全部" ? CE : CE.filter(e=>e.type===filterType);

  // ── 刷新即時股價（TWSE MIS API）───────────────────────────────
  // REFRESH_COOLDOWN moved above (near state declarations)
  // 深模組 deps 綁定：每次 render 更新，讓 useHoldingsSync 的 callback 讀到最新值
  syncDepsRef.current = { isDemo, holdings, setHoldings, setSaved, enriched: H, refreshPrices: (...a) => refreshPrices(...a) };

  // opts: { allowAuthority?: boolean, forceAuthority?: boolean }
  // 回傳 typed outcome，讓 auto effect 能依「可證實的 attempt」決定 one-shot。
  const refreshPrices = async (opts = {}) => {
    const allowAuthority = opts.allowAuthority !== false;
    if (refreshing) return { kind: 'skipped', why: 'refreshing' };
    // ── DEMO 模式 ────────────────────────────────────────────────
    // 以前這裡用 ±1.5% 亂數合成「模擬報價」，於是 8/4 午夜看到的 3443 是
    // 4,239.25，而 8/3 官方收盤是 4,185 —— 假價被當成今日收盤。
    // 現在 Demo 一律讀公開市場資料（官方日 K），對齊最後一個完整交易日；
    // 沒有已確認收盤就維持原值並標 pending，不合成、不假裝。
    if (isDemo) {
      setRefreshing(true);
      setRefreshStatus({ phase: 'fetching', total: H.length, ok: 0, fail: H.length, missingNames: [] });
      try {
        const codes = (holdings || []).map(h => String(h.code || '').trim()).filter(Boolean);
        const cards = await fetchDailyCloseCards(codes);
        let ok = 0;
        setHoldings(prev => (prev || []).map(h => {
          const cc = cards[String(h.code || '').trim()];
          if (!cc || cc.state !== 'confirmed' || !(cc.close > 0)) {
            return {
              ...h,
              priceSource: 'pending_close',
              priceTradeDate: cc?.tradeDate || null,
              priceState: 'pending',
              priceReason: cc?.reason || 'no_bars',
              priceError: cc ? confirmedCloseLabel(cc) : '尚無官方收盤',
            };
          }
          ok += 1;
          const newPrice = cc.close;
          const value = newPrice * h.qty;
          const totalCost = h.totalCost != null ? h.totalCost : h.cost * h.qty;
          const pnl = value - totalCost;
          const pct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
          return {
            ...h,
            price: newPrice,
            value, pnl, pct,
            priceSource: 'close',
            priceTradeDate: cc.tradeDate,
            priceState: 'confirmed',
            priceReason: null,
            priceUpdatedAt: cc.fetchedAt || new Date().toISOString(),
            priceError: null,
          };
        }));
        setLastUpdate(new Date());
        setRefreshStatus({ phase: 'done', total: codes.length, ok, fail: Math.max(0, codes.length - ok), missingNames: [] });
        const expected = latestCompletedTradeDate().replace(/-/g, '/');
        setSaved(ok > 0
          ? `已對齊 ${expected} 官方收盤（${ok}/${codes.length} 檔）`
          : `尚無 ${expected} 官方收盤，維持前值並標示待確認`);
        setTimeout(() => setSaved(''), 3500);
        setTimeout(() => setRefreshStatus(null), 4000);
      } finally {
        setRefreshing(false);
      }
      return { kind: 'skipped', why: 'demo' };
    }

    // 30 秒冷卻（避免按鈕連點打 cron / DB）；手動 force 也一樣受此節流
    if (lastUpdate && (Date.now() - lastUpdate.getTime()) < 30 * 1000) {
      const remaining = Math.ceil((30 * 1000 - (Date.now() - lastUpdate.getTime())) / 1000);
      setSaved(`⏳ 請等待 ${remaining} 秒後再刷新`);
      setTimeout(() => setSaved(""), 2500);
      return { kind: 'skipped', why: 'cooldown' };
    }
    setRefreshing(true);
    const codes = H.map(h => h.code);
    if (codes.length === 0) { setRefreshing(false); return { kind: 'skipped', why: 'no-holdings' }; }
    setRefreshStatus({ phase: 'fetching', total: codes.length, ok: 0, fail: codes.length, missingNames: [] });
    appendLog({ task: 'refresh-prices', status: 'start', detail: `${codes.length} 檔（讀 DB + 觸發 sync）` });

    const laneNow = new Date();
    const expectedTd = latestCompletedTradeDate(laneNow);
    const fingerprint = closeAuthorityFingerprint(expectedTd, holdings);
    let outcome = { kind: 'attempted', lane: closeAuthorityLane(laneNow, 'TW') };

    try {
      // Step 1: 觸發後端 stock-price-sync（force=1 繞過交易時段守門，給用戶手動觸發機會）
      // 不等回應，背景執行；DB Realtime 訂閱會自動把新價格推到畫面
      try {
        await supabase.functions.invoke('stock-price-sync', {
          body: { force: true },
        }).catch(() => {});
      } catch {}

      // Step 2: 走 close-authority lane 取價
      //   settled + allowAuthority → 官方日 K（唯一 confirmed）
      //   其他 lane 或 allowAuthority=false → 0 次 checkup-sparkline
      const { quotes, meta } = await fetchAuthoritativeQuotesDetailed(codes, laneNow, { allowAuthority });
      outcome = meta.attempted
        ? { kind: 'attempted', lane: meta.lane, fingerprint, transport: meta.transport }
        : (meta.lane === 'settled'
          ? { kind: 'attempted', lane: 'settled', fingerprint, authoritySkipped: true }
          : { kind: 'attempted', lane: meta.lane });

      const priceMap = {};
      Object.entries(quotes || {}).forEach(([symbol, q]) => {
        if (Number(q?.price) > 0) {
          priceMap[symbol] = {
            price: Number(q.price),
            // confirmed 才是官方收盤；snapshot 鏡像標 pending_close，其餘 db
            source: q.state === 'confirmed' ? 'close' : (q.source === 'snapshot' ? 'pending_close' : 'db'),
            updatedAt: q.updatedAt,
            tradeDate: q.tradeDate || null,   // pending 時為上游 factual 日期或 null，永不填 expected
            state: q.state,
            reason: q.reason || null,
          };
        }
      });

      const nowIso = new Date().toISOString();
      setHoldings(prev => (prev || []).map(h => {
        const hit = priceMap[h.code];
        if (!hit) {
          return { ...h, priceError: '尚無報價（可能停牌、興櫃，或 sync 尚未完成）' };
        }
        // authority 被跳過時，不得把已確認的收盤身分洗回 pending
        if (!allowAuthority && h.priceState === 'confirmed') return h;
        const { value, pnl, pct } = calcPnlWithNet(h, hit.price);
        return {
          ...h,
          price: hit.price,
          value, pnl, pct,
          priceSource: hit.source,
          priceTradeDate: hit.tradeDate,
          priceState: hit.state,
          priceReason: hit.state === 'confirmed' ? null : (hit.reason || 'stale_trade_date'),
          priceUpdatedAt: hit.updatedAt || nowIso,
          priceError: null,
        };
      }));

      const updated = Object.keys(priceMap).length;
      const total = codes.length;
      const stillMissed = codes.filter(c => !priceMap[c]);
      const missedNames = stillMissed.map(c => { const hh = H.find(x=>x.code===c); return hh ? hh.name : c; });
      setLastUpdate(new Date());
      setRefreshStatus({ phase: 'done', total, ok: updated, fail: stillMissed.length, missingNames: missedNames });
      appendLog({
        task: 'refresh-prices', status: 'ok',
        detail: `${updated}/${total} 從 DB 取得${stillMissed.length?`，缺：${missedNames.slice(0,10).join(',')}`:''}`,
      });
      if (stillMissed.length > 0 && stillMissed.length < total) {
        setSaved(`✅ ${updated}/${total} 檔已更新（${missedNames.slice(0,3).join('、')}${missedNames.length>3?'…':''} 暫無報價）`);
      } else if (updated === 0) {
        setSaved(`⏳ 後端報價尚未抵達，請稍候 5–10 秒（Realtime 會自動推送）`);
      } else {
        setSaved(`✅ ${updated} 檔股價已更新`);
      }
      setTimeout(() => setSaved(""), 4000);
      setTimeout(() => setRefreshStatus(null), 6000);
    } catch (err) {
      const msg = err?.message || '網路錯誤';
      appendLog({ task: 'refresh-prices', status: 'error', detail: msg });
      setRefreshStatus({ phase: 'error', total: codes.length, ok: 0, fail: codes.length, missingNames: [], error: msg });
      setSaved(`✕ 刷新失敗：${msg}`);
      setTimeout(() => setSaved(""), 4000);
      setTimeout(() => setRefreshStatus(null), 8000);
    } finally {
      setRefreshing(false);
    }
    return outcome;
  };

  // ── 自動刷新（進頁面 immediate + 週期 timer 共用同一條 gate）──
  // close-authority one-shot：同一 fingerprint（expected 交易日 + TW 代號集合）
  // 只要有一次 transport ok 的 attempt 完成，本次 mount 內就不再打 checkup-sparkline，
  // stale=true 也不得繞過；transport throw/absent 不記完成，60 秒後可重試。
  const holdingsAutoRefreshRef = useRef({ lastTab: null, lastRunAt: 0 });
  const authorityDoneRef = useRef(new Set());
  const autoDisposedRef = useRef(false);
  // StrictMode effect probe：setup→cleanup(true)→setup，setup 必須重設為 false，
  // 否則 ref 永久 true，authorityDoneRef 永遠不記 fingerprint，週期刷新會重打 Edge。
  useEffect(() => {
    autoDisposedRef.current = false;
    return () => { autoDisposedRef.current = true; };
  }, []);

  const runAutoRefresh = async () => {
    if (refreshing) return;
    if (!holdings || holdings.length === 0) return;
    const minutes = getAutoRefreshMinutes();
    if (minutes <= 0) return; // 使用者關閉自動刷新
    const now = new Date();
    const lane = closeAuthorityLane(now, 'TW');
    const expected = latestCompletedTradeDate(now);
    const fp = closeAuthorityFingerprint(expected, holdings);
    const authorityDone = lane === 'settled' && authorityDoneRef.current.has(fp);
    const intervalMs = minutes * 60 * 1000;
    const stale = !lastUpdate || (Date.now() - lastUpdate.getTime()) > intervalMs;
    const due = stale || needsCloseAuthorityRefresh(holdings, now);
    if (!due) return;
    // 收盤已定版且本 fingerprint 已完成 → 整次 price refresh 跳過（0 Edge）
    if (authorityDone) return;
    if (Date.now() - (holdingsAutoRefreshRef.current.lastRunAt || 0) < 60 * 1000) return;
    holdingsAutoRefreshRef.current.lastRunAt = Date.now();
    const out = await refreshPrices({ allowAuthority: true }).catch(() => null);
    if (autoDisposedRef.current) return;
    if (out && out.kind === 'attempted' && out.lane === 'settled' && out.transport === 'ok' && out.fingerprint) {
      authorityDoneRef.current.add(out.fingerprint);
    }
  };
  const runAutoRefreshRef = useRef(runAutoRefresh);
  runAutoRefreshRef.current = runAutoRefresh;

  useEffect(() => {
    holdingsAutoRefreshRef.current.lastTab = tab;
    if (tab !== 'holdings') return;
    const t = setTimeout(() => { runAutoRefreshRef.current().catch(() => {}); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, holdings]);

  // 週期性自動刷新（依使用者設定的分鐘數；0=關閉）。只在 holdings tab 且非同步中觸發。
  useEffect(() => {
    if (tab !== 'holdings') return;
    let disposed = false;
    let timerId = null;
    const schedule = () => {
      if (disposed) return;
      const minutes = getAutoRefreshMinutes();
      if (minutes <= 0) return; // off
      const intervalMs = minutes * 60 * 1000;
      timerId = setTimeout(async () => {
        if (disposed) return;
        try {
          if (document.visibilityState !== 'hidden') await runAutoRefreshRef.current();
        } catch {}
        schedule();
      }, intervalMs);
    };
    schedule();
    const onChange = () => {
      if (timerId) { clearTimeout(timerId); timerId = null; }
      schedule();
    };
    window.addEventListener('fc:holdings-auto-refresh-changed', onChange);
    return () => {
      disposed = true;
      if (timerId) clearTimeout(timerId);
      window.removeEventListener('fc:holdings-auto-refresh-changed', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, holdings?.length]);


  // 初次載入 holdings 時，用最新的 priceUpdatedAt 種入 lastUpdate，
  // 讓 Hero 立刻可以顯示「更新於 HH:MM」而不是空白
  useEffect(() => {
    if (lastUpdate) return;
    if (!holdings || holdings.length === 0) return;
    let latest = 0;
    for (const h of holdings) {
      const t = h?.priceUpdatedAt ? new Date(h.priceUpdatedAt).getTime() : 0;
      if (t > latest) latest = t;
    }
    if (latest > 0) setLastUpdate(new Date(latest));
  }, [holdings, lastUpdate]);

  // 使用者登入後，若 state 為空則從其專屬快取補回；並在 lastUpdate 變動時寫回
  useEffect(() => {
    const uid = supabaseUser?.id || null;
    if (!lastUpdate) {
      const cached = readLastUpdate(uid);
      if (cached) setLastUpdate(cached);
    }
  }, [supabaseUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const uid = supabaseUser?.id || null;
    writeLastUpdate(uid, lastUpdate);
  }, [lastUpdate, supabaseUser?.id]);



  // ── 每日收盤分析 ─────────────────────────────────────────────────
  const runDailyAnalysis = async () => {
    if (analyzing) return;
    // ── DEMO 模式（靜態）：模擬完整收盤分析流程，最後套用 DEMO_ANALYSIS ──
    if (isDemo && demoDailyMode === 'static') {
      setAnalyzing(true);
      setDailyLastError(null);
      try {
        await simulateSteps([
          { label: '取得即時股價...', min: 1000, max: 1600 },
          { label: '分析持倉表現...', min: 1200, max: 1800 },
          { label: '比對事件邏輯...', min: 1000, max: 1600 },
          { label: '策略大腦進化中...', min: 1000, max: 1600 },
        ], setAnalyzeStep);
        const demoToday = new Date().toLocaleDateString('zh-TW').replace(/-/g, '/');
        // 從目前 demo 持倉模擬 changes，讓報告檔數與持倉一致
        const demoChanges = (H || []).map(h => {
          const base = Number(h.price ?? h.cost) || 0;
          const yesterday = base > 0 ? +(base / (1 + (Math.random() * 0.04 - 0.02))).toFixed(2) : base;
          const change = +(base - yesterday).toFixed(2);
          const changePct = yesterday ? +(((base / yesterday) - 1) * 100).toFixed(2) : 0;
          return {
            code: h.code, name: h.name, type: h.type,
            price: base, yesterday, change, changePct,
            cost: h.cost, qty: h.qty,
            todayPnl: Math.round(change * (h.qty || 0)),
            totalPnl: Math.round((base - h.cost) * (h.qty || 0)),
            totalPct: h.cost ? Math.round(((base / h.cost) - 1) * 10000) / 100 : 0,
          };
        }).sort((a, b) => b.changePct - a.changePct);
        const { DEMO_ANALYSIS, DEMO_BRAIN_UPDATED } = await import("@/checkup/data/demoData");
        const demoReport = {
          id: Date.now(),
          date: demoToday,
          time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
          totalTodayPnl: demoChanges.reduce((s, c) => s + c.todayPnl, 0),
          changes: demoChanges,
          anomalies: demoChanges.filter(c => Math.abs(c.changePct) > 3),
          eventCorrelations: [],
          needsReview: [],
          autoVerified: [],
          aiInsight: DEMO_ANALYSIS.aiInsight,
          isDemo: true,
        };
        setDailyReport(demoReport);
        setAnalysisHistory(prev => [demoReport, ...(prev || []).filter(r => r.date !== demoToday)].slice(0, 30));
        setStrategyBrain(DEMO_BRAIN_UPDATED);
        setSaved('DEMO 分析完成（靜態範例）');
        setTimeout(() => setSaved(''), 4000);
      } finally {
        setAnalyzing(false);
        setAnalyzeStep('');
      }
      return;
    }
    // 非 demo 但未登入 → 引導登入（demo+live 直接放行，edge function 已支援 demo 旗標免驗證）
    if (!isDemo && !supabaseUser?.id) {
      setSaved('請先登入後再使用收盤分析');
      setTimeout(() => setSaved(''), 4000);
      navigate('/auth/login?redirect=/checkup');
      return;
    }
    let liveQuota = quota;
    if (!isDemo && supabaseUser?.id) {
      try {
        const refreshedQuota = await refreshQuota?.();
        if (refreshedQuota) liveQuota = refreshedQuota;
      } catch {}
    }
    const liveRemaining = Number(liveQuota?.remaining ?? remainingQuota ?? 0);
    const liveTier = String(liveQuota?.tier || tier || 'guest');
    const liveReachedDailyLimit = liveTier !== 'guest' && liveRemaining <= 0;
    if (liveReachedDailyLimit) {
      setSaved(liveTier === 'none' ? "目前方案無法使用收盤分析" : "目前可用分析額度已用完");
      setTimeout(() => setSaved(""), 4000);
      return;
    }
    // 產生 correlation id 與紀錄使用者操作起始時間
    const cid = `daily_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const opStartedAtMs = Date.now();
    const opStartedAt = new Date(opStartedAtMs).toISOString();
    setDailyLastError(null);
    setAnalyzing(true);
    setAnalyzeStep("取得即時股價...");
    pushUpdateLog({ source:'daily', trigger:'manual', status:'fetching', key:cid, msg:'開始收盤分析' });
    let aiInsight = null;
    let aiData = null;
    try {
      // 1. 取得最新股價
      const codes = H.map(h => h.code);
      if (codes.length === 0) { setAnalyzing(false); return; }
      const queries = codes.flatMap(c => {
        const base = [`tse_${c}.tw`, `otc_${c}.tw`];
        if (c.length >= 6) base.push(`oa_${c}.tw`);
        return base;
      });
      const exCh = queries.join('|');
      const data = await callEdge('checkup-twse', {
        query: { ex_ch: exCh },
        silent: true,
      }).catch(() => ({}));

      const priceMap = {};
      if (data.msgArray) {
        data.msgArray.forEach(item => {
          const latest = parseFloat(item.z);
          const yClose = parseFloat(item.y);
          const price = (!isNaN(latest) && latest > 0) ? latest : (!isNaN(yClose) && yClose > 0) ? yClose : null;
          const yesterday = (!isNaN(yClose) && yClose > 0) ? yClose : null;
          if (price && !priceMap[item.c]) {
            priceMap[item.c] = { price, yesterday, change: yesterday ? price - yesterday : 0, changePct: yesterday ? ((price / yesterday - 1) * 100) : 0 };
          }
        });
      }

      // 2. 計算每檔今日漲跌
      const changes = H.map(h => {
        const pm = priceMap[h.code];
        return {
          code: h.code, name: h.name, type: h.type,
          price: pm?.price || h.price,
          yesterday: pm?.yesterday || h.price,
          change: pm?.change || 0,
          changePct: pm?.changePct || 0,
          cost: h.cost, qty: h.qty,
          todayPnl: pm ? Math.round(pm.change * h.qty) : 0,
          totalPnl: pm ? Math.round((pm.price - h.cost) * h.qty) : h.pnl,
          totalPct: pm ? Math.round(((pm.price / h.cost) - 1) * 10000) / 100 : h.pct,
        };
      }).sort((a, b) => b.changePct - a.changePct);

      const totalTodayPnl = changes.reduce((s, c) => s + c.todayPnl, 0);

      // 3. 事件連動分析
      const NE = newsEvents || [];
      const today = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "/");
      const pendingEvents = NE.filter(e => e.status === "pending" || e.status === "verifying" || e.status === "tracking");
      const eventCorrelations = pendingEvents.map(e => {
        const relatedStocks = e.stocks.map(s => {
          const raw = typeof s === "string" ? s : (s.code || s.name || "");
          const code = raw.match(/\d+/)?.[0];
          const ch = changes.find(c => c.code === code);
          return ch ? { name: ch.name, code: ch.code, changePct: ch.changePct, change: ch.change, price: ch.price } : null;
        }).filter(Boolean);
        return { ...e, relatedStocks };
      }).filter(e => e.relatedStocks.length > 0 && e.relatedStocks.some(s => Math.abs(s.changePct) > 1));

      // 4. 異常波動（漲跌幅 > 3%）
      const anomalies = changes.filter(c => Math.abs(c.changePct) > 3);

      // 5. 需要復盤的事件（日期已過但未標記結果）
      const needsReview = pendingEvents.filter(e => {
        if (!e.date.match(/^\d{4}\/\d{2}/)) return false;
        return e.date <= today;
      });

      // 5.5 自動驗證事件：根據股價漲跌自動判定 pending 事件結果
      const autoVerified = [];
      if (needsReview.length > 0) {
        setNewsEvents(prev => {
          const arr = [...(prev || [])];
          needsReview.forEach(e => {
            const idx = arr.findIndex(x => x.id === e.id);
            if (idx < 0) return;
            // 找到相關股票的漲跌
            const relatedStocks = (e.stocks || []).map(s => {
              const raw = typeof s === "string" ? s : (s.code || s.name || "");
              const code = raw.match(/\d+/)?.[0];
              const ch = changes.find(c => c.code === code);
              return ch ? { name: ch.name, code: ch.code, changePct: ch.changePct } : null;
            }).filter(Boolean);
            if (relatedStocks.length === 0) return;
            const avgChange = relatedStocks.reduce((s, r) => s + r.changePct, 0) / relatedStocks.length;
            const actual = avgChange > 1 ? "up" : avgChange < -1 ? "down" : "neutral";
            const correct = e.pred === actual;
            const stockSummary = relatedStocks.map(s => `${s.name} ${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(2)}%`).join("、");
            arr[idx] = {
              ...arr[idx],
              status: "past",
              actual,
              correct,
              actualNote: `[自動驗證] 相關股票表現：${stockSummary}，平均漲跌 ${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`,
              reviewDate: today,
            };
            autoVerified.push({ title: e.title, pred: e.pred, actual, correct });
          });
          return arr;
        });
      }

      // 6. 呼叫 Claude API 產生策略分析（含策略大腦上下文）
      setAnalyzeStep("AI 策略分析中（約15-30秒）...");
      aiInsight = null;
      aiData = null;
      try {
        const holdingSummary = changes.map(c =>
          `${c.name}(${c.code}) 今日${c.changePct >= 0 ? "+" : ""}${c.changePct.toFixed(2)}% 累計${c.totalPct >= 0 ? "+" : ""}${c.totalPct}%`
        ).join("\n");
        const eventSummary = pendingEvents.map(e =>
          `[${e.date}] ${e.title} — 預測:${e.pred==="up"?"看漲":e.pred==="down"?"看跌":"中性"}`
        ).join("\n");
        const anomalySummary = anomalies.length > 0
          ? anomalies.map(a => `${a.name} ${a.changePct >= 0 ? "+" : ""}${a.changePct.toFixed(2)}%`).join(", ")
          : "無";

        // 組裝策略大腦上下文
        const brain = strategyBrain;
        const brainContext = brain ? `
══ 策略大腦（累積知識庫）══
核心策略規則：
${(brain.rules||[]).map((r,i)=>`${i+1}. ${r}`).join("\n")}

歷史教訓：
${(brain.lessons||[]).slice(-10).map(l=>`- [${l.date}] ${l.text}`).join("\n")}

勝率統計：${brain.stats?.hitRate||"尚無"}
常犯錯誤：${(brain.commonMistakes||[]).join("、")||"尚無"}
══════════════════════════` : "";

        // 反轉追蹤上下文
        const revContext = losers.length > 0 ? `
反轉追蹤持股：
${losers.map(h=>{
  const rc = (reversalConditions||{})[h.code];
  return `${h.name}(${h.code}) ${h.pct}% | 反轉條件：${rc?.signal||"未設定"} | 停損：${rc?.stopLoss||"未設定"}`;
}).join("\n")}` : "";

        const analyzeController = new AbortController();
        const analyzeTimer = setTimeout(() => analyzeController.abort(), 120000); // 2 min timeout
        let aiHttpStatus = 200;
        let aiErrBody = '';
        try {
          aiData = await callEdge('checkup-analyze', {
            headers: { 'x-correlation-id': cid },
            signal: analyzeController.signal,
            silent: true,
            body: {
              demo: isDemo,
              systemPrompt: `你是一位專業的台股策略分析師，也是用戶的長期策略顧問。
你擁有用戶過去所有分析的記憶（策略大腦），必須基於累積的教訓和規則來給出建議。
用戶是積極型事件驅動交易者，持有股票+權證，專注電子科技族群。

請用繁體中文，以精準簡潔的風格分析今日收盤表現。格式：

## 今日總結
（一句話概括）

## 事件連動分析
（哪些股價變動與待觀察事件有關聯？邏輯是什麼？）

## 反轉追蹤
（虧損持股今日表現如何？有沒有接近反轉訊號？）

## 風險提醒
（基於策略大腦的歷史教訓，需要注意什麼？）

## 明日觀察重點
（明天盤中應該關注什麼？）

## 操作建議
（具體的買賣建議或等待條件）

## 策略進化建議
（基於今日表現，策略大腦應該新增或修改什麼規則？）`,
              userPrompt: `今日日期：${today}
今日持倉損益：${totalTodayPnl >= 0 ? "+" : ""}${totalTodayPnl.toLocaleString()} 元
${brainContext}
${revContext}

持倉明細：
${holdingSummary}

異常波動（>3%）：${anomalySummary}

待觀察事件：
${eventSummary}

${autoVerified.length > 0 ? `今日自動驗證事件（${autoVerified.length}件）：
${autoVerified.map(v => `- ${v.title}：預測${v.pred==="up"?"看漲":"看跌"} → 實際${v.actual==="up"?"漲":"跌"} → ${v.correct?"✓正確":"✗有誤"}`).join("\n")}` : ""}

請分析今日收盤表現，事件連動，並給出策略建議。特別注意策略大腦中的歷史教訓。${autoVerified.length > 0 ? "同時針對今日自動驗證的事件進行覆盤分析。" : ""}`
            }
          });
        } catch (e) {
          clearTimeout(analyzeTimer);
          aiHttpStatus = e?.status || 0;
          aiErrBody = typeof e?.body === 'object' ? JSON.stringify(e.body) : (e?.message || '');
          // 配額用盡：toast + 仰賴 DailyTab inline banner 顯示完整升級 CTA
          if (aiHttpStatus === 429 && (e?.body?.error === 'QUOTA_EXCEEDED' || /QUOTA_EXCEEDED/.test(aiErrBody))) {
            try { await refreshQuota?.(); } catch {}
            toast.error('AI 健檢配額已用完，請查看升級方案');
            setAnalyzing(false); setAnalyzeStep("");
            return;
          }
          if (e?.name === 'AbortError') {
            const errInfo = { code: 'TIMEOUT', message: 'AbortError', cid, opStartedAt, opStartedAtMs, httpStatus: 0, at: new Date().toISOString() };
            setDailyLastError(errInfo);
            pushUpdateLog({ source:'daily', trigger:'manual', status:'error', key:cid, msg:`TIMEOUT` });
          } else if (aiHttpStatus > 0) {
            const code = aiHttpStatus === 402 ? 'AI_BILLING_REQUIRED'
                       : aiHttpStatus === 429 ? 'AI_RATE_LIMITED'
                       : aiHttpStatus === 401 ? 'AI_AUTH_FAILED'
                       : `HTTP_${aiHttpStatus}`;
            const errInfo = { code, message: aiErrBody.slice(0, 240) || `HTTP ${aiHttpStatus}`, cid, opStartedAt, opStartedAtMs, httpStatus: aiHttpStatus, at: new Date().toISOString() };
            setDailyLastError(errInfo);
            pushUpdateLog({ source:'daily', trigger:'manual', status:'error', key:cid, msg:`${code} (${aiHttpStatus})` });
            console.error("[daily] AI 分析失敗", errInfo);
          } else {
            const errInfo = { code: 'NETWORK_ERROR', message: String(e?.message || e).slice(0, 240), cid, opStartedAt, opStartedAtMs, httpStatus: 0, at: new Date().toISOString() };
            setDailyLastError(errInfo);
            pushUpdateLog({ source:'daily', trigger:'manual', status:'error', key:cid, msg:`NETWORK_ERROR` });
            console.error("[daily] AI 分析例外", errInfo);
          }
        }
        clearTimeout(analyzeTimer);
        if (aiData) {
          if (aiData?.fallback) {
            const code = aiData.code || 'AI_FALLBACK';
            const errInfo = { code, message: String(aiData.error || '').slice(0, 240) || code, cid, opStartedAt, opStartedAtMs, httpStatus: 200, at: new Date().toISOString() };
            setDailyLastError(errInfo);
            pushUpdateLog({ source:'daily', trigger:'manual', status:'error', key:cid, msg:`fallback ${code}` });
            console.error("[daily] AI fallback", errInfo);
          } else {
            aiInsight = aiData.content?.[0]?.text || aiData.text || aiData.response || null;
          }
        }
      } catch (e) {
        const code = e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
        const errInfo = { code, message: String(e?.message || e).slice(0, 240), cid, opStartedAt, opStartedAtMs, httpStatus: 0, at: new Date().toISOString() };
        setDailyLastError(errInfo);
        pushUpdateLog({ source:'daily', trigger:'manual', status:'error', key:cid, msg:`${code}` });
        console.error("[daily] AI 分析例外", errInfo);
      }

      // 7. 組裝報告
      const report = {
        id: Date.now(),
        date: today,
        time: new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }),
        totalTodayPnl,
        changes,
        anomalies,
        eventCorrelations,
        needsReview: needsReview.filter(e => !autoVerified.find(v => v.title === e.title)),
        autoVerified,
        aiInsight,
      };

      setDailyReport(report);
      setAnalysisHistory(prev => [report, ...(prev || []).filter(r => r.date !== today)].slice(0, 30));
      if (aiData?.quota) { try { applyQuotaFromResponse?.(aiData); } catch {} }

      // 8. 策略大腦進化 — 讓 AI 更新策略知識庫
      setAnalyzeStep("策略大腦進化中...");
      if (aiInsight) {
        try {
          const NE = newsEvents || [];
          const pastEvents = NE.filter(e => e.status === "past");
          const hits = pastEvents.filter(e => e.correct === true).length;
          const total = pastEvents.filter(e => e.correct !== null).length;

          const brainData = await callEdge('checkup-analyze', {
            silent: true,
            body: {
              demo: isDemo,
              kind: 'brain-update',
              systemPrompt: `你是策略知識庫管理器。根據今日分析結果，更新策略大腦。
回傳**純JSON**格式（不要markdown code block），結構：
{"rules":["規則1","規則2",...],"lessons":[{"date":"日期","text":"教訓"}],"commonMistakes":["錯誤1",...],"stats":{"hitRate":"X/Y","totalAnalyses":N},"lastUpdate":"日期"}

規則：基於累積經驗的核心交易策略（最多15條，去掉過時的）
教訓：今日新增的具體教訓（只加新的，保留舊的）
常犯錯誤：反覆出現的錯誤模式`,
              userPrompt: `今日分析：
${aiInsight}

現有策略大腦：
${JSON.stringify(strategyBrain || { rules: [], lessons: [], commonMistakes: [], stats: {} })}

預測命中率：${hits}/${total}
今日損益：${totalTodayPnl >= 0 ? "+" : ""}${totalTodayPnl.toLocaleString()} 元

請更新策略大腦，保留有效的舊規則，加入今日新教訓。`
            }
          });
          const brainText = brainData?.content?.[0]?.text || "";
          const cleanBrain = brainText.replace(/```json|```/g, "").trim();
          const newBrain = JSON.parse(cleanBrain);
          setStrategyBrain(newBrain);
        } catch (e) {
          console.error("策略大腦更新失敗:", e);
        }
      }

      // 同步更新持倉價格
      setHoldings(prev => (prev || []).map(h => {
        const pm = priceMap[h.code];
        if (!pm) return h;
        const { value, pnl, pct } = calcPnlWithNet(h, pm.price);
        return { ...h, price: pm.price, value, pnl, pct };
      }));

      setLastUpdate(new Date());
      if (!dailyLastError) {
        pushUpdateLog({ source:'daily', trigger:'manual', status:'success', key:cid, msg:'完成' });
      }
    } catch (err) {
      const code = err?.name === 'AbortError' ? 'TIMEOUT' : 'PIPELINE_ERROR';
      const errInfo = { code, message: String(err?.message || err).slice(0, 240), cid, opStartedAt, opStartedAtMs, httpStatus: 0, at: new Date().toISOString() };
      setDailyLastError(errInfo);
      pushUpdateLog({ source:'daily', trigger:'manual', status:'error', key:cid, msg:`${code}` });
      console.error("[daily] 收盤分析失敗", errInfo);
      setSaved("❌ 分析失敗");
      setTimeout(() => setSaved(""), 3000);
    }
    setAnalyzing(false);
    setAnalyzeStep("");
  };

  // 重試按鈕：點擊瞬間鎖定，避免重複送出；無論成功失敗都會在 finally 解鎖
  // 同時記錄重試時間軸（開始/結束/結果）並在結束後自動展開錯誤摘要
  const handleDailyRetry = async () => {
    if (dailyRetryLockRef.current || analyzing) return;
    dailyRetryLockRef.current = true;
    setDailyRetryLocked(true);
    const attempt = ++dailyRetryAttemptRef.current;
    const startedAt = Date.now();
    const entryId = `retry_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    // 先寫入「進行中」狀態
    setDailyRetryHistory(prev => [{
      id: entryId, attempt, startedAt, endedAt: null, durationMs: null,
      success: null, cid: null, code: null, message: null, httpStatus: null,
    }, ...prev].slice(0, 20));
    pushUpdateLog({ source:'daily', trigger:'retry', status:'fetching', key:`#${attempt}`, msg:`重試開始 (第 ${attempt} 次)` });
    setUpdateLogOpen(true);
    let succeeded = false;
    try {
      await runDailyAnalysis();
      succeeded = !dailyLastErrorRef.current;
    } finally {
      const endedAt = Date.now();
      const last = dailyLastErrorRef.current;
      const finalSuccess = !last || (last && last.cid && last.opStartedAtMs && last.opStartedAtMs < startedAt);
      setDailyRetryHistory(prev => prev.map(r => r.id === entryId ? {
        ...r,
        endedAt,
        durationMs: endedAt - startedAt,
        success: finalSuccess,
        cid: last?.cid ?? null,
        code: last?.code ?? null,
        message: last?.message ?? null,
        httpStatus: last?.httpStatus ?? null,
      } : r));
      pushUpdateLog({
        source:'daily',
        trigger:'retry',
        status: finalSuccess ? 'success' : 'error',
        key:`#${attempt}`,
        msg: finalSuccess
          ? `重試成功（${endedAt - startedAt}ms）`
          : `重試失敗 ${last?.code || 'UNKNOWN'}（${endedAt - startedAt}ms）`,
      });
      dailyRetryLockRef.current = false;
      setDailyRetryLocked(false);
      // 觸發錯誤摘要自動聚焦
      setDailyErrorFocusKey(k => k + 1);
    }
  };

  // ── 事件復盤 ─────────────────────────────────────────────────────
  const submitReview = (eventId) => {
    const form = reviewFormRef.current;
    setNewsEvents(prev => {
      const arr = [...(prev || [])];
      const idx = arr.findIndex(e => e.id === eventId);
      if (idx < 0) return arr;
      arr[idx] = {
        ...arr[idx],
        status: "past",
        actual: form.actual,
        actualNote: form.actualNote,
        correct: arr[idx].pred === form.actual,
        lessons: form.lessons,
        reviewDate: new Date().toLocaleDateString("zh-TW"),
      };
      return arr;
    });
    setReviewingEvent(null);
    setReviewForm({ actual: "up", actualNote: "", lessons: "" });
    setSaved("✅ 復盤已儲存");
    setTimeout(() => setSaved(""), 2500);
  };
  // Phase A2-1: keep submitReviewRef in sync so NewsEventRow can call it via stableSubmitReview
  useEffect(() => { submitReviewRef.current = submitReview; });

  // ── 新增事件 ─────────────────────────────────────────────────────
  const addEvent = () => {
    if (!newEvent.title.trim() || !newEvent.date.trim()) return;
    const id = `manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const evt = {
      id,
      stableId: id,
      date: newEvent.date,
      status: "pending",
      title: newEvent.title,
      detail: newEvent.detail,
      stocks: newEvent.stocks.split(/[,，、]/).map(s => s.trim()).filter(Boolean),
      pred: newEvent.pred,
      predReason: newEvent.predReason,
      actual: null, actualNote: "", correct: null,
      source: "manual",
    };
    setNewsEvents(prev => [...(prev || []), evt]);
    setNewEvent({ date: "", title: "", detail: "", stocks: "", pred: "up", predReason: "" });
    setShowAddEvent(false);
    setSaved("✅ 事件已新增");
    setTimeout(() => setSaved(""), 2500);
  };

  // ── 反轉條件更新 ─────────────────────────────────────────────────
  const updateReversal = (code, conditions) => {
    setReversalConditions(prev => ({
      ...(prev || {}),
      [code]: { ...conditions, updatedAt: new Date().toLocaleDateString("zh-TW") },
    }));
    setSaved("✅ 反轉條件已儲存");
    setTimeout(() => setSaved(""), 2500);
  };

  // 收盤分析完全手動觸發，不自動執行

  // file
  const processFile = (file) => {
    if (!file?.type?.startsWith("image/")) return;
    setImg(URL.createObjectURL(file));
    setParsed(null); setParseErr(null);
    setMemoStep(0); setMemoAns([]); setMemoIn("");
    const r = new FileReader();
    r.onload = e => setB64(e.target.result.split(",")[1]);
    r.readAsDataURL(file);
  };

  // 讀檔為 base64（共用於批次與單張）
  const readFileAsBase64 = (file) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = e => res(e.target.result.split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });

  // 把批次的某一張回復到主預覽區（讓使用者看圖或看錯誤訊息）
  const restoreBatchItemPreview = (item) => {
    if (!item) return;
    setTab("trade");
    setImg(item.previewUrl || null);
    setB64(item.b64 || null);
    setParsed(null);
    setParseErr(item.status === 'failed' ? (item.error || '解析失敗') : null);
  };

  // 取消整批：標記後續未處理為 cancelled，當前那張會跑完再停
  const cancelBatch = () => {
    batchCancelRef.current = true;
    setBatchState(s => s ? ({
      ...s,
      cancelled: true,
      items: s.items.map(it => it.status === 'pending' ? { ...it, status: 'cancelled' } : it),
    }) : s);
    toast.info('已要求停止後續解析，已完成的結果會保留');
  };

  // 內部：實際跑批次。可傳入 itemIds 子集（重試用）
  const runBatch = async (targetIds = null) => {
    batchCancelRef.current = false;
    setBatchState(s => s ? ({ ...s, running: true, cancelled: false }) : s);
    // 用 ref 讀目前 items（避免 stale closure）
    const snapshot = batchStateRef.current;
    if (!snapshot) return;
    const queue = snapshot.items.filter(it =>
      (targetIds ? targetIds.includes(it.id) : true) &&
      (it.status === 'pending' || it.status === 'failed' || it.status === 'cancelled')
    );
    if (!queue.length) {
      setBatchState(s => s ? ({ ...s, running: false }) : s);
      return;
    }
    let okCount = 0, failCount = 0, cancelCount = 0;
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (batchCancelRef.current) {
        cancelCount += (queue.length - i);
        // 剩餘標 cancelled
        setBatchState(s => s ? ({
          ...s,
          items: s.items.map(it => queue.slice(i).some(q => q.id === it.id) && it.status !== 'success' ? { ...it, status: 'cancelled' } : it),
        }) : s);
        break;
      }
      // 標 parsing
      setBatchState(s => s ? ({
        ...s,
        currentIndex: i + 1,
        items: s.items.map(it => it.id === item.id ? { ...it, status: 'parsing', error: null } : it),
      }) : s);
      try {
        setTab('trade');
        setImg(item.previewUrl);
        setB64(item.b64);
        setParsed(null); setParseErr(null);
        await new Promise(r => setTimeout(r, 30));
        const isLast = i === queue.length - 1;
        const result = await parseShot({
          b64Override: item.b64,
          suppressTabSwitch: !isLast,
          batchInfo: { index: i + 1, total: queue.length, name: item.name },
        });
        const ok = result === true || result?.ok === true;
        const err = result?.error || null;
        const errorDetail = result?.errorDetail || null;
        setBatchState(s => s ? ({
          ...s,
          items: s.items.map(it => it.id === item.id ? {
            ...it,
            status: ok ? 'success' : 'failed',
            error: ok ? null : (err || it.error || '解析失敗'),
            errorDetail: ok ? null : (errorDetail || it.errorDetail || null),
          } : it),
        }) : s);
        if (ok) okCount++; else failCount++;
      } catch (e) {
        failCount++;
        const msg = e?.message || '網路錯誤';
        setBatchState(s => s ? ({
          ...s,
          items: s.items.map(it => it.id === item.id ? {
            ...it,
            status: 'failed',
            error: msg,
            errorDetail: { type: 'exception', message: msg, stack: (e?.stack || '').slice(0, 600) || null },
          } : it),
        }) : s);
        console.warn('batch parse file failed:', e);
      }
    }
    setBatchState(s => s ? ({ ...s, running: false }) : s);
    if (cancelCount > 0) {
      toast.warning(`已停止批次：成功 ${okCount}、失敗 ${failCount}、取消 ${cancelCount}`);
    } else if (failCount === 0) {
      toast.success(`批次解析完成 ${okCount}/${queue.length} 張`);
    } else {
      toast.warning(`批次完成：成功 ${okCount}、失敗 ${failCount}（可點「重試解析」）`);
    }
  };

  // 重試失敗的：保留成功結果，只重跑 failed/cancelled
  const retryBatchFailures = async () => {
    const snap = batchStateRef.current;
    if (!snap) return;
    const targets = snap.items.filter(it => it.status === 'failed' || it.status === 'cancelled').map(it => it.id);
    if (!targets.length) { toast.info('沒有需要重試的項目'); return; }
    // 將目標重設為 pending
    setBatchState(s => s ? ({
      ...s,
      items: s.items.map(it => targets.includes(it.id) ? { ...it, status: 'pending', error: null } : it),
    }) : s);
    // 等 state flush
    await new Promise(r => setTimeout(r, 30));
    await runBatch(targets);
  };

  // ADR-0005 §5：批次解析面板槽位——HoldingsTab（M1）不再直連 M4 的 BatchParsePanel，
  // 由 shell 決定放什麼；沒有批次項目時回傳 null，tradeIO chunk 也就不會被載入。
  const batchParseSlot = batchState?.items?.length ? (
    <Suspense fallback={null}>
      <BatchParsePanel
        C={C}
        batchState={batchState}
        cancelBatch={cancelBatch}
        retryBatchFailures={retryBatchFailures}
        restoreBatchItemPreview={restoreBatchItemPreview}
        variant="holdings"
      />
    </Suspense>
  ) : null;

  // 多圖批次上傳：依序自動解析每張截圖
  // - 單張 → 沿用原本「預覽 + 手動點解析」UX
  // - 多張 → 自動排隊逐張解析 + 進度條 + 取消 + 重試
  const processFiles = async (filesLike) => {
    const list = Array.from(filesLike || []).filter(f => f && f.type?.startsWith("image/"));
    if (!list.length) return;
    // 一次最多 10 張（UI 文案承諾）— 超過直接擋下整批，不啟動任何批次
    const MAX_BATCH_FILES = 10;
    if (list.length > MAX_BATCH_FILES) {
      toast.error(`一次最多上傳 ${MAX_BATCH_FILES} 張截圖（本次選了 ${list.length} 張）`, {
        description: '請拆成多批上傳，或減少選取張數後再試一次',
      });
      return;
    }
    if (list.length === 1) { processFile(list[0]); return; }
    if (isDemo) { startLineLogin(); return; }
    if (parsing || batchStateRef.current?.running) {
      toast.warning("目前仍有截圖在解析中，請稍候再上傳");
      return;
    }
    // 預先讀完所有檔案為 base64 + objectURL（讓 list 能立即顯示縮圖／重試）
    const items = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        const b64v = await readFileAsBase64(file);
        items.push({
          id: `${Date.now()}-${i}-${file.name}`,
          name: file.name || `截圖 ${i + 1}`,
          size: file.size || 0,
          previewUrl: URL.createObjectURL(file),
          b64: b64v,
          status: 'pending',
          error: null,
        });
      } catch (e) {
        items.push({
          id: `${Date.now()}-${i}-${file.name}`,
          name: file.name || `截圖 ${i + 1}`,
          size: file.size || 0,
          previewUrl: null,
          b64: null,
          status: 'failed',
          error: '讀檔失敗',
        });
      }
    }
    setBatchState({ items, currentIndex: 0, total: items.length, running: false, cancelled: false });
    await new Promise(r => setTimeout(r, 30));
    toast.info(`開始批次解析 ${items.length} 張截圖`, { description: "可隨時按「停止批次」中斷後續張數" });
    await runBatch();
  };

  const mergeTradeIntoHoldings = (holdingsList, trade) => {
    const action = String(trade?.action || "").trim();
    const code = String(trade?.code || "").trim();
    const name = String(trade?.name || "").trim();
    const qty = Number(trade?.qty) || 0;
    const price = Number(trade?.price) || 0;
    const tradeTotalCost = trade?.total_cost != null ? Number(trade.total_cost) : null;
    const tradeFee = trade?.fee != null ? Number(trade.fee) : null;

    if (!code || qty <= 0 || price <= 0) return holdingsList;

    const arr = [...holdingsList];
    const idx = arr.findIndex(h => h.code === code);

    const mktPrice = Number(trade?.market_price) || price; // 市價，若無則用成交價

    if (action === "買進") {
      if (idx >= 0) {
        const h = arr[idx];
        const nq = h.qty + qty;
        const nc = calcWeightedAvgCost(h.cost, h.qty, price, qty);
        const mp = mktPrice || h.price;
        // 合併 totalCost 和 fee
        const newTotalCost = (h.totalCost != null && tradeTotalCost != null)
          ? h.totalCost + tradeTotalCost
          : (tradeTotalCost != null ? tradeTotalCost : h.totalCost);
        const newFee = (h.fee != null && tradeFee != null)
          ? h.fee + tradeFee
          : (tradeFee != null ? tradeFee : h.fee);
        const { value, pnl, pct } = calcPnlWithNet(
          { ...h, qty: nq, cost: nc, totalCost: newTotalCost, fee: newFee, code },
          mp
        );
        arr[idx] = {
          ...h,
          name: h.name || name,
          qty: nq,
          price: mp,
          cost: Math.round(nc * 100) / 100,
          totalCost: newTotalCost,
          fee: newFee,
          value, pnl, pct,
          priceSource: 'screenshot',
          priceUpdatedAt: new Date().toISOString(),
          priceError: null,
        };
      } else {
        const newH = {
          code, name, qty,
          price: mktPrice,
          cost: price,
          totalCost: tradeTotalCost,
          fee: tradeFee,
          type: inferHoldingType(code, name),
          priceSource: 'screenshot',
          priceUpdatedAt: new Date().toISOString(),
          priceError: null,
        };
        const { value, pnl, pct } = calcPnlWithNet(newH, mktPrice);
        arr.push({ ...newH, value, pnl, pct });
      }
      return arr;
    }

    if (idx >= 0) {
      const h = arr[idx];
      const nq = Math.max(0, h.qty - qty);
      if (nq === 0) {
        arr.splice(idx, 1);
      } else {
        const mp = mktPrice || h.price;
        // 賣出時按比例縮減 totalCost 和 fee
        const { newTotalCost, newFee } = calcRemainingCostAfterPartialSell(h.totalCost, h.fee, nq, h.qty);
        const { value, pnl, pct } = calcPnlWithNet(
          { ...h, qty: nq, totalCost: newTotalCost, fee: newFee, code: h.code },
          mp
        );
        arr[idx] = {
          ...h, qty: nq, price: mp, totalCost: newTotalCost, fee: newFee,
          value, pnl, pct,
        };
      }
    }

    return arr;
  };

  const hasExplicitTradeAction = (trade) => {
    const action = String(trade?.action || "").trim();
    return action === "買進" || action === "賣出";
  };

  const upsertSnapshotHolding = (holdingsList, trade) => {
    const code = String(trade?.code || "").trim();
    const name = String(trade?.name || "").trim();
    const qty = Number(trade?.qty) || 0;
    const cost = Number(trade?.price) || 0;
    const marketPrice = Number(trade?.market_price) || cost;
    const totalCost = trade?.total_cost != null ? Number(trade.total_cost) : null;
    const fee = trade?.fee != null ? Number(trade.fee) : null;

    if (!code || qty <= 0 || cost <= 0) return holdingsList;

    const arr = [...holdingsList];
    const idx = arr.findIndex((holding) => holding.code === code);
    const prev = idx >= 0 ? arr[idx] : null;
    const nextHolding = {
      ...(prev || {}),
      code,
      name: name || prev?.name || code,
      qty,
      price: marketPrice,
      cost,
      totalCost,
      fee,
      type: prev?.type || inferHoldingType(code, name),
      priceSource: 'screenshot',
      priceUpdatedAt: new Date().toISOString(),
      priceError: null,
    };
    const { value, pnl, pct } = calcPnlWithNet(nextHolding, marketPrice);
    const finalizedHolding = { ...nextHolding, value, pnl, pct };

    if (idx >= 0) arr[idx] = finalizedHolding;
    else arr.push(finalizedHolding);

    return arr;
  };

  const parseShot = async (opts = {}) => {
    const { b64Override, suppressTabSwitch = false, batchInfo = null } = opts;
    const b64Used = b64Override || b64;
    if (!b64Used) return { ok: false, error: '無影像資料', errorDetail: { type: 'no_image', message: '檔案資料遺失，請重新上傳該截圖' } };
    // Demo 模式 → 要求先 LINE 登入
    if (isDemo) {
      startLineLogin();
      return { ok: false, error: '請先 LINE 登入', errorDetail: { type: 'demo_locked', message: 'Demo 模式無法解析，請先 LINE 登入' } };
    }
    // 截圖解析 = auth-only（checkup-parse edge 不扣 quota）
    // 不在前端做 quota 攔截，避免 line_free 用完的使用者被擋在上傳/建立持倉之外
    // 若後端規則改變回 429，下方 catch 區塊仍有兜底處理
    setParsing(true); setParseErr(null);
    const batchPrefix = batchInfo ? `（${batchInfo.index}/${batchInfo.total}）` : '';
    setParseStep({ stage: 'upload', label: `${batchPrefix}上傳截圖至 AI Vision`, progress: 10, detail: `影像大小約 ${Math.round((b64Used?.length || 0) * 0.75 / 1024)} KB` });


    const MAX_RETRIES = 3;
    let lastErr = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        setParseStep({
          stage: attempt === 1 ? 'ai' : 'retry',
          label: attempt === 1 ? 'AI 解析持倉資料中' : `AI 解析重試 ${attempt}/${MAX_RETRIES}`,
          progress: attempt === 1 ? 30 : 30 + (attempt - 1) * 10,
          detail: attempt === 1 ? '使用 Gemini 2.5 Pro Vision' : `上次失敗：${lastErr || '未知錯誤'}`,
        });
        let data;
        try {
          data = await callEdge('checkup-parse', {
            silent: true,
            body: {
              systemPrompt: PARSE_PROMPT,
              base64: b64Used,
              mediaType: "image/jpeg",
            }
          });
        } catch (e) {
          // 配額用盡兜底（截圖解析）
          // 配額用盡：toast + 仰賴 TradeTab inline banner（L162）顯示完整升級 CTA
          if (e?.status === 429 && (e?.body?.error === 'QUOTA_EXCEEDED' || /QUOTA_EXCEEDED/.test(JSON.stringify(e?.body || {})))) {
            try { await refreshQuota?.(); } catch {}
            toast.error('LINE 註冊禮已用完，請查看升級方案');
            setParseStep({ stage: 'error', label: '配額已用完', progress: 0, detail: '請見下方升級方案' });
            setParsing(false);
            return { ok: false, error: 'QUOTA_EXCEEDED', errorDetail: {
              type: 'quota',
              status: e?.status || 429,
              code: 'QUOTA_EXCEEDED',
              message: e?.body?.message || e?.body?.error || 'LINE 註冊禮已用完，請查看升級方案',
              body: e?.body || null,
              hint: '免費額度已用完，可升級方案或等待下次配額更新',
            }};
          }
          // 其他錯誤丟給下方 retry 邏輯處理
          lastErr = String(e?.body?.error || e?.message || `HTTP ${e?.status || 0}`);
          console.warn(`Parse attempt ${attempt}/${MAX_RETRIES} failed:`, lastErr);
          appendLog({ task: 'parse-screenshot', status: 'retry', attempt, detail: lastErr });
          if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 2000)); continue; }
          break;
        }
        if (data?.quota) { try { applyQuotaFromResponse?.(data); } catch {} }

        // 後端回傳 error 表示所有模型都失敗，嘗試重試
        if (data.error) {
          lastErr = data.error;
          console.warn(`Parse attempt ${attempt}/${MAX_RETRIES} failed:`, data.error);
          appendLog({ task: 'parse-screenshot', status: 'retry', attempt, detail: data.error });
          if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 2000)); continue; }
          break;
        }

        const clean = (data.content?.[0]?.text||"").replace(/```json|```/g,"").trim();
        const parsedResult = JSON.parse(clean);
        const parsedTrades = Array.isArray(parsedResult?.trades) ? parsedResult.trades : [];
        const isSnapshotImport = parsedTrades.length > 0 && parsedTrades.every((trade) => !hasExplicitTradeAction(trade));
        const preparedTrades = parsedTrades.map((trade) => ({
          ...trade,
          action: hasExplicitTradeAction(trade)
            ? String(trade.action).trim()
            : (isSnapshotImport ? SNAPSHOT_IMPORT_ACTION : "買進"),
        }));
        parsedResult.trades = preparedTrades;
        setParsed(parsedResult);
        setParseStep({ stage: 'persist', label: '寫入持倉與交易記錄', progress: 70, detail: `辨識出 ${preparedTrades.length} 筆部位` });

        // 解析成功後立即同步持倉 & 交易記錄
        if (preparedTrades.length) {
          // 50 檔上限防呆：估算合併後的代碼數，超過則擋下整批匯入
          const currentCodes = new Set((holdings || []).map(h => h.code));
          const incomingCodes = new Set(preparedTrades.map(t => String(t?.code || "").trim()).filter(Boolean));
          const merged = new Set([...currentCodes, ...incomingCodes]);
          if (merged.size > MAX_HOLDINGS) {
            setParseErr(
              `持倉上限 ${MAX_HOLDINGS} 檔，目前 ${currentCodes.size} 檔、本次解析新增 ${incomingCodes.size} 檔`
              + `（合計 ${merged.size} 檔超出 ${merged.size - MAX_HOLDINGS} 檔），請先整理或減少匯入筆數`
            );
            setParseStep({ stage: 'error', label: '持倉超出上限', progress: 70, detail: `合計 ${merged.size} / 上限 ${MAX_HOLDINGS}` });
            setParsing(false);
            return { ok: false, error: `持倉超出上限（合計 ${merged.size} / 上限 ${MAX_HOLDINGS}）`, errorDetail: {
              type: 'limit_exceeded',
              message: `持倉超出上限（合計 ${merged.size} / 上限 ${MAX_HOLDINGS}）`,
              current: currentCodes.size,
              incoming: incomingCodes.size,
              merged: merged.size,
              limit: MAX_HOLDINGS,
              hint: '請先整理或減少匯入筆數',
            }};
          }
          holdingsChangedByUserRef.current = true; // 標記為使用者主動變動持倉
          // 計算「新增 / 更新」摘要：以解析前的持倉代碼判斷
          const prevCodeSet = new Set((holdings || []).map(h => h.code));
          const summaryAdded = [];
          const summaryUpdated = [];
          preparedTrades.forEach(t => {
            const code = String(t?.code || "").trim();
            if (!code) return;
            const item = { code, name: String(t?.name || "").trim(), qty: Number(t?.qty) || 0, price: Number(t?.price) || 0, action: t.action };
            if (prevCodeSet.has(code)) summaryUpdated.push(item);
            else summaryAdded.push(item);
          });
          setHoldings(prev => preparedTrades.reduce(
            (acc, trade) => isSnapshotImport ? upsertSnapshotHolding(acc, trade) : mergeTradeIntoHoldings(acc, trade),
            stripDemoSeedHoldings(prev || []),
          ).map(markUserOwnedHolding));
          setTradeLog(prev => {
            const existing = prev || [];
            const newEntries = preparedTrades.map(t => ({
              id: Date.now() + Math.random(),
              date: t.date || new Date().toLocaleDateString("zh-TW"),
              time: t.time || new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"}),
              action: t.action === SNAPSHOT_IMPORT_ACTION ? "匯入" : t.action,
              code: t.code, name: t.name, qty: t.qty, price: t.price,
              qa: [],
            }));
            return [...newEntries, ...existing];
          });
          setSaved("✅ 成交已更新到持倉與記錄");
          toast.success(`已寫入 ${preparedTrades.length} 筆成交`, { description: "持倉與交易紀錄已即時更新" });
          setTimeout(() => setSaved(""), 2500);
          // 設定上傳摘要（批次模式下，僅最後一張切換至持倉頁，避免反覆跳頁）
          setUploadSummary({ added: summaryAdded, updated: summaryUpdated, at: Date.now() });
          if (!suppressTabSwitch) setTab("holdings");
          // 12 秒後自動隱藏摘要
          setTimeout(() => setUploadSummary(s => (s && Date.now() - s.at >= 11000) ? null : s), 12000);
          // ✨ 解析成功後自動拉一次 TWSE 即時報價，避免依賴截圖內 market_price
          setParseStep({ stage: 'refresh', label: '同步 TWSE 即時報價', progress: 90, detail: '繞過冷卻自動執行一次' });
          try {
            setLastUpdate(null);
            setTimeout(() => { refreshPrices().catch(() => {}); }, 600);
          } catch (e) { console.warn('auto-refresh after parse failed:', e); }
        }
        setParseStep({ stage: 'done', label: '解析完成', progress: 100, detail: `共 ${preparedTrades.length} 筆持倉已寫入` });
        appendLog({ task: 'parse-screenshot', status: 'ok', attempt, detail: `${preparedTrades.length} 筆部位` });
        setTimeout(() => setParseStep(null), 4000);
        setParsing(false);
        return { ok: true }; // 成功，直接返回
      } catch (e) {
        lastErr = e?.message || "網路錯誤";
        console.warn(`Parse attempt ${attempt}/${MAX_RETRIES} exception:`, e);
        appendLog({ task: 'parse-screenshot', status: 'retry', attempt, detail: lastErr });
        if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 2000)); continue; }
      }
    }

    // 所有重試都失敗
    const finalErr = lastErr || "解析失敗，請確認截圖清晰";
    setParseErr(finalErr);
    toast.error("AI 解析失敗", { description: finalErr });
    setParseStep({ stage: 'error', label: 'AI 解析失敗', progress: 100, detail: finalErr });
    appendLog({ task: 'parse-screenshot', status: 'error', detail: `所有重試失敗：${finalErr}` });
    setTimeout(() => setParseStep(null), 6000);
    setParsing(false);
    return { ok: false, error: finalErr, errorDetail: {
      type: 'parse_failed',
      attempts: MAX_RETRIES,
      lastMessage: finalErr,
      hint: '已重試 3 次仍失敗，可重試或更換更清晰的截圖',
    }};
  };

  const submitMemo = () => {
    if (!parsed?.trades?.length) return;
    const t = parsed.trades[0];
    const qs = MEMO_Q[t.action]||MEMO_Q["買進"];
    const ans = [...memoAns, memoIn];
    setMemoIn("");
    if (memoStep < qs.length-1) { setMemoAns(ans); setMemoStep(memoStep+1); return; }

    const entry = {
      id:Date.now(),
      date:new Date().toLocaleDateString("zh-TW"),
      time:new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"}),
      action:t.action, code:t.code, name:t.name, qty:t.qty, price:t.price,
      qa: qs.map((q,i)=>({q, a:ans[i]||""})),
    };
    setTradeLog(prev=>[entry,...(prev||[])]);

    setSaved("✅ 已儲存備忘錄");
    toast.success("備忘錄已儲存", { description: `${entry.action} ${entry.name} ${entry.qty}股` });
    setTimeout(()=>setSaved(""),2500);

    // 若截圖含目標價更新
    if (parsed.targetPriceUpdates?.length) {
      setTargets(prev => {
        const updated = {...(prev||{})};
        parsed.targetPriceUpdates.forEach(u => {
          const existing = updated[u.code] || {reports:[]};
          const already  = existing.reports.find(r=>r.firm===u.firm);
          const newReport = {firm:u.firm, target:u.target, date:u.date||new Date().toLocaleDateString("zh-TW")};
          const newReports = already
            ? existing.reports.map(r=>r.firm===u.firm ? newReport : r)
            : [...existing.reports, newReport];
          updated[u.code] = { reports:newReports, updatedAt:new Date().toLocaleDateString("zh-TW"), isNew:true };
        });
        return updated;
      });
    }

    setImg(null); setB64(null); setParsed(null);
    setMemoStep(0); setMemoAns([]); setMemoIn("");
    setTab("holdings");
  };

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Batch D IA §2：手機頂欄「更多」sheet
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const mobileActionsSheetRef = useRef(null);
  const mobileActionsTriggerRef = useRef(null);
  const mobileActionsPrevFocus = useRef(null);
  // a11y：ESC 關閉 + body overflow 鎖定 + 焦點陷阱 + 關閉後回到觸發按鈕
  useEffect(() => {
    if (!mobileActionsOpen) return;
    // 1) 記住觸發前的焦點（若沒抓到 trigger ref 就退回 activeElement）
    mobileActionsPrevFocus.current =
      mobileActionsTriggerRef.current ||
      (typeof document !== 'undefined' ? document.activeElement : null);

    const getFocusable = () => {
      const root = mobileActionsSheetRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMobileActionsOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusables = getFocusable();
        if (focusables.length === 0) {
          e.preventDefault();
          mobileActionsSheetRef.current?.focus?.();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 2) 初次焦點：sheet 本身（讓讀屏從 aria-labelledby 的標題唸起，
    //    再往下依 DOM 順序：更多 → 選項 → 取消）
    const t = setTimeout(() => {
      mobileActionsSheetRef.current?.focus?.();
    }, 0);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      // 3) 關閉後回到原本觸發按鈕
      try { mobileActionsPrevFocus.current?.focus?.(); } catch {}
    };
  }, [mobileActionsOpen]);



  const clearAnalysisAndLessons = () => {
    if (!confirm("確定要清除『歷史分析記錄』與『最近教訓』嗎？")) return;

    setAnalysisHistory([]);
    setStrategyBrain(null);
    setDailyReport(null);
    save("pf-analysis-history-v1", []);
    save("pf-brain-v1", null);

    setSaved("🧹 已清除歷史分析與最近教訓");
    setTimeout(() => setSaved(""), 2500);
  };

  const resetAll = () => {
    resetGuardRef.current += 1;
    // 清除 localStorage
    ["pf-holdings-v2","pf-log-v2","pf-targets-v1","pf-news-events-v1",
     "pf-analysis-history-v1","pf-reversal-v1","pf-brain-v1","pf-calendar-v1"].forEach(k => localStorage.removeItem(k));
    setHoldings([]); setTradeLog([]); setTargets({});
    setNewsEvents([]); setAnalysisHistory([]); setReversalConditions({});
    setStrategyBrain(null); setDailyReport(null); setCalendarEvents(null);
    setCalendarLoading(false);
    setImg(null); setB64(null); setParsed(null); setParseErr(null);
    setMemoStep(0); setMemoAns([]); setMemoIn("");
    setTab("holdings");
    setShowResetConfirm(false);

    // 雲端清空所有 pf-* key
    const uid = getCurrentUserId();
    if (uid) {
      CLOUD_SYNC_KEYS.forEach(k => {
        const emptyVal = k === "pf-calendar-v1" ? { events: [], holdingCodes: "" }
          : k === "pf-brain-v1" ? {} : (k.includes("history") || k.includes("news") ? [] : {});
        supabase.from("checkup_storage").upsert({ user_id: uid, key: k, data: emptyVal, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" }).then(() => {}).catch(() => {});
      });
      supabase.from("checkup_storage").upsert({ user_id: uid, key: "pf-calendar-holdings", data: { stocks: "", holdingCodes: "" }, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" }).then(() => {}).catch(() => {});
      // 清除雲端交易備忘錄
      supabase.from("checkup_trade_memos").delete().neq("id", "00000000-0000-0000-0000-000000000000").then(() => {}).catch(() => {});
    }

    setSaved("🗑️ 已全部清除");
    setTimeout(() => setSaved(""), 2500);
  };

  const qs = parsed?.trades?.[0] ? (MEMO_Q[parsed.trades[0].action]||MEMO_Q["買進"]) : [];

  if (!ready) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",
      alignItems:"center",justifyContent:"center",color:C.textMute,
      fontFamily:"sans-serif",fontSize:15}}>載入中...</div>
  );

  // Monocle 改版：頂欄 4 tab（持倉／收盤／事件／記錄）；上傳成交改為右上「＋ 上傳」橘鈕開頁；
  // 事件頁內含 news 已驗證態（tab 內兩態切換，見批次 3）。tab 值 'news'/'trade'/'research' 保留供內部
  // setTab 呼叫（例如上傳成功後 setTab('holdings')），只是不顯示在頂欄。
  const TABS = [
    {k:"holdings", label:"持倉"},
    {k:"daily",    label:analyzing?"分析中…":"收盤分析"},
    {k:"events",   label:`事件${urgentCount>0?" ·":""}`},
    {k:"log",      label:"記錄"},
  ];


  return (
    <div className="checkup-mono" style={{background:C.bg,minHeight:"100vh",color:C.text,
      fontFamily:"'Noto Sans TC','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",paddingBottom:40,
      WebkitFontSmoothing:"antialiased",MozOsxFontSmoothing:"grayscale"}}>

      <SEO
        title="免費 AI 持倉診斷 | legendflow"
        description="免費試用 AI 持倉診斷：自動分析個股、行事曆事件、收盤焦點與交易日誌，一次掌握你的投資組合風險與機會。"
        path="/holding-checkup"
      />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        html{-webkit-text-size-adjust:100%}
        body{-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
        textarea::placeholder,input::placeholder{color:${C.textMute}}
        input,textarea,button{font-family:inherit;-webkit-appearance:none}
        @keyframes progress{0%{width:5%}50%{width:70%}100%{width:95%}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @media(max-width:480px){
          body{font-size:14px}
        }
        /* Hero RWD：inline fontSize:88 在窄螢幕會壓爆右側，必須用 className 覆寫 */
        @media(max-width:560px){
          .wb-hero-grid{
            grid-template-columns: 1fr !important;
            align-items: flex-start !important;
            gap: 14px !important;
          }
          .wb-hero-market{
            align-items: flex-start !important;
          }
          .wb-hero-pnl-num{
            font-size: 56px !important;
            letter-spacing: -0.03em !important;
          }
          .wb-hero-pnl-pct{
            font-size: 18px !important;
          }
          .wb-hero-kpi{
            grid-template-columns: repeat(2, minmax(0,1fr)) !important;
            gap: 14px 18px !important;
          }
          .wb-card-pnl-num{
            font-size: 36px !important;
            letter-spacing: -0.03em !important;
          }
          .wb-card-pnl-pct{
            font-size: 14px !important;
          }
        }
        @media(max-width:380px){
          .wb-hero-pnl-num{ font-size: 44px !important; }
          .wb-card-pnl-num{ font-size: 30px !important; }
        }
      `}</style>

      {/* ── 介紹影片折疊入口已下移至看板核心之後（demo 首屏可見性修復），見頁尾 ── */}

      {/* DEMO banner 已移除（§6.5：首次三步引導 + 頁腳提示取代所有 tab 內 demo cta） */}

      {/* ── BACK BUTTON + 戰情室入口 ── */}
      <div style={{background:C.bg,borderBottom:`1px solid ${C.border}`,padding:"8px 16px",position:"sticky",top:0,zIndex:11,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={()=>navigate("/")} style={{
          background:"none",border:"none",cursor:"pointer",padding:"2px 0",
          color:C.textSec,fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:4,
          letterSpacing:"0.01em",
        }}>
          ← 返回
        </button>
        {!isDemo && (
          <button onClick={()=>navigate("/app")} className="cm-header-desktop-only" style={{
            background:C.blue,border:"none",cursor:"pointer",padding:"4px 12px",borderRadius:6,
            color:"#fff",fontSize:12,fontWeight:500,display:"flex",alignItems:"center",gap:4,
          }}>
            前往戰情室 →
          </button>
        )}
      </div>

      {/* ── HEADER ── */}
      <div style={{background:C.bg,borderBottom:`1px solid ${C.border}`,
        padding:"14px 16px 0",position:"sticky",top:34,zIndex:10}}>

        {/* §2 憲法：舊 page header（持倉看板 + KPI + 立即更新 + ⋯）已移除，
             Hero 已呈現同資訊；同步狀態/錯誤 banner 保留於下方。 */}

        {/* 報價同步狀態 — 顯示成功/失敗檔數與卡關標的 */}
        {refreshStatus && (
          <div data-testid="refresh-status-banner" style={{
            margin:'10px 0 4px', padding:'8px 12px',
            borderRadius:6,
            border:`1px solid ${refreshStatus.phase==='error'?alpha(C.down,'44'):refreshStatus.phase==='done' && refreshStatus.fail===0?alpha(C.olive,'44'):C.border}`,
            background: alpha(C.subtle,'88'),
            display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',
          }}>
            <span style={{fontSize:11,fontWeight:500,letterSpacing:'0.06em',color:refreshStatus.phase==='error'?C.down:C.text}}>
              {refreshStatus.phase==='fetching' && '⟳ 抓取 TWSE 報價'}
              {refreshStatus.phase==='done' && refreshStatus.fail===0 && '✓ 報價同步完成'}
              {refreshStatus.phase==='done' && refreshStatus.fail>0 && `△ 同步部分完成 ${refreshStatus.ok}/${refreshStatus.total}`}
              {refreshStatus.phase==='error' && '✕ 同步失敗'}
            </span>
            {refreshStatus.phase!=='fetching' && refreshStatus.missingNames?.length>0 && (
              <span style={{fontSize:11,color:C.textSec,fontWeight:600}}>
                無報價：{refreshStatus.missingNames.slice(0,5).join('、')}{refreshStatus.missingNames.length>5?` 等 ${refreshStatus.missingNames.length} 檔`:''}
              </span>
            )}
            {refreshStatus.error && (
              <span style={{fontSize:11,color:C.down}}>{refreshStatus.error}</span>
            )}
          </div>
        )}

        {/* 螢幕閱讀器可讀的全域同步狀態播報（polite） */}
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{position:'absolute',width:1,height:1,padding:0,margin:-1,overflow:'hidden',clip:'rect(0 0 0 0)',whiteSpace:'nowrap',border:0}}>
          {serverSyncing ? '正在同步持倉現價，請稍候…' : (syncError ? '' : (refreshStatus?.phase === 'done' ? (refreshStatus.fail > 0 ? `同步部分完成，成功 ${refreshStatus.ok} 檔，失敗 ${refreshStatus.fail} 檔` : '持倉現價已同步完成') : ''))}
        </span>

        {/* H4/H5 recompute UI：換價 / 排程失敗的持久錯誤 + 重試 */}
        {syncError && (
          <div
            role="alertdialog"
            aria-live="assertive"
            aria-atomic="true"
            aria-labelledby="sync-error-banner-title"
            aria-describedby="sync-error-banner-message sync-error-banner-detail"
            data-testid="sync-error-banner"
            style={{
              margin:'8px 0 4px', padding:'8px 12px',
              borderRadius:6,
              border:`1px solid ${alpha(C.down,'66')}`,
              background: alpha(C.down,'11'),
              display:'flex', alignItems:'flex-start', gap:10, flexWrap:'wrap',
            }}>

            <div style={{display:'flex',flexDirection:'column',gap:2,flex:'1 1 240px',minWidth:0}}>
              {/* 可辨識標題（h4）—— 提供螢幕閱讀器導覽用的區段名稱 */}
              <h4
                id="sync-error-banner-title"
                data-testid="sync-error-banner-title"
                style={{
                  margin:0, fontSize:11, fontWeight:700,
                  color:C.down, letterSpacing:'0.08em', textTransform:'uppercase',
                }}>
                {syncError.exhausted ? '報價同步連續失敗' : (syncError.partial ? '部分報價同步失敗' : '報價同步失敗')}
              </h4>
              <span
                id="sync-error-banner-message"
                data-testid="sync-error-message"
                style={{fontSize:11,fontWeight:600,color:C.down,letterSpacing:'0.04em',wordBreak:'break-word'}}>
                ✕ {syncError.message}
              </span>
              <span
                id="sync-error-banner-detail"
                data-testid="sync-error-detail"
                style={{fontSize:10,color:C.textSec,fontWeight:500,letterSpacing:'0.02em'}}>
                {syncError.httpStatus != null && syncError.httpStatus !== 0 ? `HTTP ${syncError.httpStatus}` : (syncError.httpStatus === 0 ? '網路/無回應' : '')}
                {syncError.rawMessage ? `　${syncError.rawMessage}` : ''}
                {syncError.attempts ? `　嘗試 ${syncError.attempts} 次` : ''}
                {syncError.exhausted ? '　⚠︎ 建議重新整理或稍後再試' : ''}
              </span>
              {syncError.exhausted && (
                <div
                  data-testid="sync-error-exhausted-hint"
                  role="group"
                  aria-label="連續失敗後的建議動作"
                  style={{display:'flex',gap:8,alignItems:'center',marginTop:4,flexWrap:'wrap'}}>
                  <button
                    type="button"
                    data-testid="sync-error-refresh"
                    onClick={() => { try { window.location.reload(); } catch {} }}
                    style={{
                      background:'transparent', color:C.down, border:`1px solid ${alpha(C.down,'66')}`,
                      borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer',
                    }}>手動重新整理頁面</button>
                  <span style={{fontSize:10,color:C.textSec}}>或稍後再試</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={triggerServerSync}
              disabled={serverSyncing}
              data-testid="sync-error-retry"
              style={{
                background: serverSyncing ? alpha(C.subtle,'aa') : C.down,
                color: serverSyncing ? C.textMute : '#fff',
                border:'none', borderRadius:6, padding:'3px 10px',
                fontSize:11, fontWeight:600, cursor: serverSyncing ? 'wait' : 'pointer',
                letterSpacing:'0.04em',
              }}>{serverSyncing ? '重試中…' : '重試'}</button>
            <button
              type="button"
              data-testid="sync-error-copy"
              onClick={async () => {
                const text = [
                  `[${new Date().toISOString()}] freecheckup sync error`,
                  `message: ${syncError.message}`,
                  syncError.httpStatus != null ? `httpStatus: ${syncError.httpStatus}` : null,
                  syncError.rawMessage ? `raw: ${syncError.rawMessage}` : null,
                  syncError.attempts ? `attempts: ${syncError.attempts}` : null,
                  syncError.failedCodes?.length ? `failedCodes: ${syncError.failedCodes.join(',')}` : null,
                  `consecutiveFail: ${consecutiveFailRef.current}`,
                ].filter(Boolean).join('\n');
                try {
                  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
                  else {
                    const ta = document.createElement('textarea'); ta.value = text;
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                  }
                  setSyncCopyState('copied');
                  setTimeout(() => setSyncCopyState(''), 2000);
                } catch {}
              }}
              style={{
                background:'transparent', color:C.text, border:`1px solid ${C.border}`,
                borderRadius:6, padding:'3px 8px', fontSize:11, cursor:'pointer',
              }}>{syncCopyState === 'copied' ? '✓ 已複製' : '複製錯誤內容'}</button>
            {/* 複製成功的 aria-live 播報：politie 不打斷、但螢幕閱讀器會即時讀出 */}
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="sync-copy-status"
              style={{position:'absolute',width:1,height:1,padding:0,margin:-1,overflow:'hidden',clip:'rect(0 0 0 0)',whiteSpace:'nowrap',border:0}}>
              {syncCopyState === 'copied' ? '錯誤內容已複製到剪貼簿' : ''}
            </span>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              aria-label="關閉錯誤提示"
              style={{
                background:'transparent', color:C.textSec, border:`1px solid ${C.border}`,
                borderRadius:6, padding:'3px 8px', fontSize:11, cursor:'pointer',
              }}>關閉</button>
          </div>
        )}

        {/* today alert - match calendar events by today's date */}
        {todayEvents.length>0 && (
          <div style={{
            borderRadius:4,padding:"7px 10px",marginBottom:10,
            fontSize:12,color:C.text,lineHeight:1.7,fontWeight:600}}>
            今日 · {todayEvents.map(e=>e.label).join(" · ")}
          </div>
        )}

        {/* Monocle 頂欄：4 tab + 右側「＋ 上傳」橘鈕（開上傳成交頁，內部仍走 tab='trade'） */}
        <div className="cm-desktop-tabs" style={{display:"flex",alignItems:"center",gap:0,marginTop:2,borderBottom:"1px solid var(--cm-hair)"}}>
          <div style={{display:"flex",gap:0,overflowX:"auto",paddingBottom:0,flex:1}}>
            {TABS.map(t=>(
              <button key={t.k} onClick={()=>{setTab(t.k);try{window.dispatchEvent(new CustomEvent('checkup:tab-change',{detail:{tab:t.k}}))}catch{}trackRaw('checkup_tab_change',{tab:t.k});window.scrollTo({top:0,behavior:"smooth"})}} style={{
                background:"transparent",
                color: tab===t.k ? "var(--cm-ink)" : "var(--cm-ink-sec)",
                border:"none",
                borderBottom: tab===t.k ? "2px solid var(--cm-ink)" : "2px solid transparent",
                padding:"10px 14px",
                fontSize:13, fontWeight:tab===t.k ? 700 : 500,
                cursor:"pointer", whiteSpace:"nowrap",
                letterSpacing:"0.04em",
                borderRadius:0,
              }}>{t.label}</button>
            ))}
          </div>
          <button
            type="button"
            className="cm-upload-cta"
            data-testid="checkup-upload-cta"
            onClick={()=>{openUploadModal();trackRaw('checkup_tab_change',{tab:'trade',via:'upload_cta'});}}
            aria-label="上傳成交"
            style={{marginLeft:8}}
          >＋ 上傳</button>
        </div>
        {/* 手機底欄 tab bar — 五格：持倉／收盤／[＋ 圓鈕]／事件／記錄 */}
        <nav className="cm-mobile-tabbar" aria-label="持倉診斷分頁">
          {[
            {k:'holdings',l:'持倉'},
            {k:'daily',l:'收盤'},
          ].map(t=>(
            <button key={t.k} type="button" className="cm-mobile-tabbar__btn"
              aria-current={tab===t.k?'page':undefined}
              onClick={()=>{setTab(t.k);trackRaw('checkup_tab_change',{tab:t.k,via:'mobile_tabbar'});window.scrollTo({top:0,behavior:"smooth"})}}
            >{t.l}</button>
          ))}
          <button
            type="button"
            className="cm-mobile-tabbar__upload"
            data-testid="checkup-upload-cta-mobile"
            aria-label="上傳成交"
            onClick={()=>{openUploadModal();trackRaw('checkup_tab_change',{tab:'trade',via:'mobile_upload_cta'});}}
          >＋</button>
          {[
            {k:'events',l:'事件'},
            {k:'log',l:'記錄'},
          ].map(t=>(
            <button key={t.k} type="button" className="cm-mobile-tabbar__btn"
              aria-current={tab===t.k?'page':undefined}
              onClick={()=>{setTab(t.k);trackRaw('checkup_tab_change',{tab:t.k,via:'mobile_tabbar'});window.scrollTo({top:0,behavior:"smooth"})}}
            >{t.l}</button>
          ))}
        </nav>
      </div>

      <div className="cm-page-content">{/* padding 由 --cm-page-px 提供，Batch E §3 */}


        {/* ══════════ HOLDINGS ══════════ */}
        {/* #region Tab: Holdings — 持倉看板（Hero + .wb-card 牆 + Detail Panel） */}
        {tab==="holdings" && (
          <Suspense fallback={null}>
            <HoldingsTab
              navigate={navigate}
              C={C}
              alpha={alpha}
              WB={WB}
              wbTone={wbTone}
              quota={quota}
              tier={tier}
              tierLabel={tierLabel}
              formatResetCountdown={formatResetCountdown}
              totalVal={totalVal}
              totalCost={totalCost}
              H={H}
              winnersCount={winnersCount}
              exitListCount={exitList.length}
              reviewListCount={reviewList.length}
              MAX_HOLDINGS={MAX_HOLDINGS}
              rtConnected={rtConnected}
              lastUpdate={lastUpdate}
              refreshing={refreshing || serverSyncing}
              onRefreshPrices={triggerServerSync}
              refreshError={syncError ? (syncError.exhausted ? `連續失敗 ${syncError.attempts || ''} 次：${syncError.message || '報價同步失敗'}` : (syncError.message || '報價同步失敗')) : null}

              uploadSummary={uploadSummary}
              setUploadSummary={setUploadSummary}
              batchParseSlot={batchParseSlot}
              losers={losers}
              reversalConditions={reversalConditions}
              reviewingEvent={reviewingEvent}
              setReviewingEvent={setReviewingEvent}
              updateReversal={updateReversal}
              globalPriorityList={globalPriorityList}
              decisionsMap={decisionsMap}
              STOCK_META={STOCK_META}
              filteredSortedList={filteredSortedList}
              searchQ={searchQ}
              setSearchQ={setSearchQ}
              filterDecision={filterDecision}
              setFilterDecision={setFilterDecision}
              filterThesis={filterThesis}
              setFilterThesis={setFilterThesis}
              filterUrgency={filterUrgency}
              setFilterUrgency={setFilterUrgency}
              filterConflict={filterConflict}
              setFilterConflict={setFilterConflict}
              filterPnl={filterPnl}
              setFilterPnl={setFilterPnl}
              filterStrategy={filterStrategy}
              setFilterStrategy={setFilterStrategy}
              toggleSetItem={toggleSetItem}
              clearAllFilters={clearAllFilters}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortDir={sortDir}
              setSortDir={setSortDir}
              targets={targets}
              avgTarget={avgTarget}
              normalizedEvents={normalizedEvents}
              showAll={showAll}
              setShowAll={setShowAll}
              holdingSyncStates={holdingSyncStates}
              setTab={setTab}
              tradeLog={tradeLog}
            />

          </Suspense>
        )}
        {/* #endregion Tab: Holdings */}

        {/* ══════════ EVENTS ══════════ */}
        {/* #region Tab: Events — 事件追蹤 */}
        {tab==="events" && (
          <Suspense fallback={null}>
            <EventsTab
              isDemo={isDemo}
              navigate={navigate}
              startLineLogin={startLineLogin}
              C={C}
              alpha={alpha}
              TYPE_COLOR={TYPE_COLOR}
              RETRY_MAX={RETRY_MAX}
              calendarAutoStatus={calendarAutoStatus}
              predictAutoStatus={predictAutoStatus}
              calendarLoading={calendarLoading}
              predictingEvents={predictingEvents}
              calendarRetry={calendarRetry}
              predictRetry={predictRetry}
              calendarLastError={calendarLastError}
              predictLastError={predictLastError}
              calendarLastDebug={calendarLastDebug}
              predictLastDebug={predictLastDebug}
              setCalendarLastDebug={setCalendarLastDebug}
              setPredictLastDebug={setPredictLastDebug}
              debugPanelOpen={debugPanelOpen}
              setDebugPanelOpen={setDebugPanelOpen}
              updateLog={updateLog}
              setUpdateLog={setUpdateLog}
              updateLogOpen={updateLogOpen}
              setUpdateLogOpen={setUpdateLogOpen}
              classifyAttempt={classifyAttempt}
              deriveSuggestion={deriveSuggestion}
              holdings={holdings}
              newsEvents={newsEvents}
              H={H}
              CE={CE}
              filteredEvents={filteredEvents}
              filterType={filterType}
              setFilterType={setFilterType}
              calendarExpanded={calendarExpanded}
              setCalendarExpanded={setCalendarExpanded}
              manualRefreshCalendar={manualRefreshCalendar}
              runPredictEvents={runPredictEvents}
            />
          </Suspense>
        )}
        {/* #endregion Tab: Events */}

        {/* ══════════ DAILY ANALYSIS ══════════ */}
        {/* #region Tab: Daily — 盤後分析 */}
        {tab==="daily" && (
          <Suspense fallback={null}>
            <DailyTab
              isDemo={isDemo}
              navigate={navigate}
              startLineLogin={startLineLogin}
              C={C}
              alpha={alpha}
              demoDailyMode={demoDailyMode}
              setDemoDailyMode={setDemoDailyMode}
              dailyReport={dailyReport}
              setDailyReport={setDailyReport}
              analyzing={analyzing}
              analyzeStep={analyzeStep}
              runDailyAnalysis={runDailyAnalysis}
              hasReachedDailyLimit={hasReachedDailyLimit}
              quota={quota}
              formatResetCountdown={formatResetCountdown}
              tier={tier}
              needsAddFriend={needsAddFriend}
              dailyLastError={dailyLastError}
              setDailyLastError={setDailyLastError}
              dailyErrorRef={dailyErrorRef}
              dailyRetryHistory={dailyRetryHistory}
              dailyRetryLocked={dailyRetryLocked}
              handleDailyRetry={handleDailyRetry}
              pc={pc}
              setTab={setTab}
              setExpandedNews={setExpandedNews}
              coverageOpen={coverageOpen}
              setCoverageOpen={setCoverageOpen}
              coverageReport={coverageReport}
              setCoverageReport={setCoverageReport}
              strategyBrain={strategyBrain}
              setStrategyBrain={setStrategyBrain}
              save={save}
              cloudSync={cloudSync}
              analysisHistory={analysisHistory}
            />
          </Suspense>
        )}
        {/* #endregion Tab: Daily */}

        {/* ══════════ UPLOAD ══════════ */}
        {/* #region Tab: Trade — Batch C §6.3：改為 modal；`tab==='trade'` 走 modal 開啟，內部 setTab('trade') 呼叫（上傳成功後導回）維持原 flow */}
        {(() => {
          const tradeProps = {
            C, alpha, card, lbl,
            parsing, parseStep, parseErr,
            parsed, setParsed,
            img, dragOver, setDragOver,
            processFile, processFiles, parseShot,
            batchState, cancelBatch,
            retryBatchFailures, restoreBatchItemPreview,
            setImg, setB64, setParseErr,
            isDemo, startLineLogin,
            hasReachedDailyLimit, tier, quota,
            formatResetDateTime,
            formatResetCountdown,
            holdings, setHoldings, setTradeLog,
            setUploadSummary,
            holdingsChangedByUserRef,
            stripDemoSeedHoldings,
            mergeTradeIntoHoldings,
            upsertSnapshotHolding,
            SNAPSHOT_IMPORT_ACTION,
            MAX_HOLDINGS,
            toast,
            setTab: (t) => { if (t === 'holdings') { setUploadModalOpen(false); } setTab(t); },
            memoAns, memoIn, setMemoIn,
            memoStep, qs, submitMemo,
            tpCode, setTpCode,
            tpFirm, setTpFirm,
            tpVal, setTpVal,
            setTargets, setSaved,
          };
          const modalOpen = uploadModalOpen || tab === 'trade';
          return (
            <Suspense fallback={null}>
              <TradeUploadModal
                open={modalOpen}
                onClose={() => { setUploadModalOpen(false); if (tab === 'trade') setTab('holdings'); }}
                C={C} alpha={alpha}
                quota={quota}
                formatResetCountdown={formatResetCountdown}
                tradeProps={tradeProps}
              />
            </Suspense>
          );
        })()}
        {/* #endregion Tab: Trade */}


        {/* ══════════ LOG ══════════ */}
        {/* #region Tab: Log — 交易日誌 */}
        {tab==="log" && (
          <Suspense fallback={null}>
            <LogTab
              isDemo={isDemo}
              tradeLog={tradeLog}
              C={C}
              alpha={alpha}
              card={card}
              startLineLogin={startLineLogin}
              navigate={navigate}
            />
          </Suspense>
        )}
        {/* #endregion Tab: Log */}

        {/* ══════════ NEWS ANALYSIS ══════════ */}
        {/* #region Tab: News — 新聞分析 */}
        {tab==="news" && (
          <Suspense fallback={null}>
            <NewsTab
              isDemo={isDemo}
              newsEvents={newsEvents}
              predictingEvents={predictingEvents}
              C={C}
              alpha={alpha}
              card={card}
              lbl={lbl}
              showAddEvent={showAddEvent}
              setShowAddEvent={setShowAddEvent}
              newEvent={newEvent}
              setNewEvent={setNewEvent}
              addEvent={addEvent}
              
              toast={toast}
              expandedNews={expandedNews}
              reviewingEvent={reviewingEvent}
              reviewForm={reviewForm}
              stableToggleNews={stableToggleNews}
              stableStartReview={stableStartReview}
              stableCancelReview={stableCancelReview}
              stableChangeReview={stableChangeReview}
              stableSubmitReview={stableSubmitReview}
              newsVerifyingExpanded={newsVerifyingExpanded}
              setNewsVerifyingExpanded={setNewsVerifyingExpanded}
              newsPendingExpanded={newsPendingExpanded}
              setNewsPendingExpanded={setNewsPendingExpanded}
              newsPastExpanded={newsPastExpanded}
              setNewsPastExpanded={setNewsPastExpanded}
              startLineLogin={startLineLogin}
              navigate={navigate}
            />
          </Suspense>
        )}
        {/* #endregion Tab: News */}

        {tab==="research" && (
          <Suspense fallback={null}>
            <ResearchTab
              isDemo={isDemo}
              C={C}
              alpha={alpha}
              card={card}
              lbl={lbl}
              holdings={holdings}
              navigate={navigate}
              startLineLogin={startLineLogin}
              setTab={setTab}
            />
          </Suspense>
        )}

        {/* Batch C §6.5：Demo/LINE 頁腳一行提示（取代散落各 tab 頂部的 banner） */}
        <Suspense fallback={null}>
          <DemoFooterHint
            isDemo={isDemo}
            C={C}
            onStartLine={() => { try { startLineLogin?.(); } catch { navigate('/auth/login?redirect=/checkup'); } }}
            onStartEmail={() => navigate('/auth/login?redirect=/checkup')}
          />
        </Suspense>
      </div>
      {/* Batch C §6.5：首次進站 onboarding overlay */}
      <Suspense fallback={null}>
        <OnboardingOverlay
          C={C}
          onStartLine={() => { try { startLineLogin?.(); } catch { navigate('/auth/login?redirect=/checkup'); } }}
          onStartDemo={() => { /* demo 為預設狀態，關閉即進入 */ }}
        />
      </Suspense>
      {/* Decision Debug toggle：僅開發環境顯示，避免污染正式介面 */}
      {import.meta.env.DEV && (
        <div style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:8}}>
          <label style={{fontSize:10,color:C.textMute,fontWeight:400,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            <input type="checkbox" checked={debugMode} onChange={e => {
              setDebugMode(e.target.checked);
              if (typeof window !== 'undefined') window.__DECISION_DEBUG = e.target.checked;
            }} style={{width:12,height:12}} />
            Decision Debug
          </label>
        </div>
      )}
      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:100,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={() => setShowResetConfirm(false)}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:C.card, borderRadius:12, padding:"28px 24px", maxWidth:360, width:"100%",
            border:`1px solid ${alpha(C.textMute,'08')}`}}>
            <div style={{fontSize:14,fontWeight:500,color:C.up,marginBottom:10,textAlign:"center",letterSpacing:"0.02em"}}>
              確認清除全部資料？
            </div>
            <div style={{fontSize:12,color:C.textMute,marginBottom:6,lineHeight:1.7,textAlign:"center"}}>
              此操作<span style={{color:C.up,fontWeight:500}}>無法復原</span>，將永久刪除以下所有資料：
            </div>
            <div style={{background:C.subtle,borderRadius:8,padding:"10px 14px",marginBottom:16,
              fontSize:12,color:C.textMute,lineHeight:2}}>
              持倉資料（所有股票部位）<br/>
              交易日誌（所有買賣紀錄）<br/>
              行事曆事件（法說、財報等）<br/>
              事件分析（預測與復盤紀錄）<br/>
              收盤分析（歷史分析報告）<br/>
              策略大腦（AI 學習紀錄）<br/>
              目標價資料<br/>
              歷史分析紀錄<br/>
              最近教訓
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={() => setShowResetConfirm(false)} style={{
                flex:1, background:C.subtle, color:C.text, border:`1px solid ${alpha(C.textMute,'08')}`,
                borderRadius:8, padding:"10px 0", fontSize:13, fontWeight:400, cursor:"pointer",
              }}>取消</button>
              <button onClick={resetAll} style={{
                flex:1, background:C.up, color:"#fff", border:"none",
                borderRadius:8, padding:"10px 0", fontSize:13, fontWeight:500, cursor:"pointer",
              }}>確認全部清除</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch D §2：手機頂欄「更多」sheet — 收納同步、補價、日誌、清除 */}
      {mobileActionsOpen && (
        <>
          <div
            className="cm-mobile-actions-sheet__backdrop"
            data-testid="mobile-actions-sheet-backdrop"
            aria-hidden="true"
            onClick={()=>setMobileActionsOpen(false)}
          />
          <div
            ref={mobileActionsSheetRef}
            id="cm-mobile-actions-sheet"
            className="cm-mobile-actions-sheet"
            data-testid="mobile-actions-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cm-mobile-actions-title"
            tabIndex={-1}
            style={{ outline: 'none' }}
          >
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:10,paddingBottom:8,borderBottom:'1px solid var(--cm-ink)'}}>
              <h3 id="cm-mobile-actions-title" className="cm-mobile-actions-sheet__title" style={{margin:0,padding:0,border:'none'}}>更多</h3>
              <button
                type="button"
                aria-label="關閉更多選項"
                data-testid="mobile-actions-sheet-close"
                onClick={()=>setMobileActionsOpen(false)}
                style={{background:'transparent',border:'none',fontSize:20,lineHeight:1,cursor:'pointer',color:'var(--cm-ink-sec)',padding:'4px 8px',minWidth:32,minHeight:32}}
              ><span aria-hidden="true">×</span></button>
            </div>


            {!isDemo && (
              <button type="button" className="cm-mobile-actions-sheet__item"
                onClick={()=>{ setMobileActionsOpen(false); navigate("/app"); }}>
                前往戰情室 →
              </button>
            )}
            {H.length > 0 && (
              <button type="button" className="cm-mobile-actions-sheet__item"
                disabled={serverSyncing}
                onClick={()=>{ setMobileActionsOpen(false); triggerServerSync(); }}>
                {serverSyncing ? '同步中…' : '⟳ 立即更新報價'}
              </button>
            )}
            {H.length > 0 && (H || []).some(h => !h.priceSource || h.priceError) && (
              <button type="button" className="cm-mobile-actions-sheet__item"
                disabled={backfilling}
                onClick={()=>{ setMobileActionsOpen(false); runBackfillReport(); }}>
                {backfilling ? '補抓中…' : '補齊缺價持倉'}
              </button>
            )}
            {syncLog.length > 0 && (
              <button type="button" className="cm-mobile-actions-sheet__item"
                onClick={()=>{ setMobileActionsOpen(false); downloadSyncLog(); }}>
                ↓ 下載任務日誌（{syncLog.length}）
              </button>
            )}
            <button type="button" className="cm-mobile-actions-sheet__item cm-mobile-actions-sheet__item--danger"
              onClick={()=>{ setMobileActionsOpen(false); setShowResetConfirm(true); }}>
              清除全部資料
            </button>
            <button type="button" className="cm-mobile-actions-sheet__item"
              style={{ textAlign: 'center', color: 'var(--cm-ink-sec)' }}
              onClick={()=>setMobileActionsOpen(false)}>
              取消
            </button>
          </div>
        </>
      )}
      {/* 配額不足 modal 已移除（2026-06）— 全螢幕遮罩會擋住 tab 導航，
          現改用 TradeTab/DailyTab inline banner + toast 提示。見 .lovable/plan.md */}

      {/* ── 介紹影片折疊入口（從頂部下移，避免擠掉首屏看板核心） ── */}
      {/* §6.5：HoldingsIntroVideo 開場影片已移除，改由 OnboardingOverlay 三步文案卡取代 */}
    </div>
  );
}
// #endregion App()
