import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_FN_BASE } from "@/pages/_freeCheckup/constants";
import { demoDelay } from "@/checkup/utils/demoSimulate";
import { normalizeHoldingMetrics } from "@/checkup/lib/holdings.js";
import { readLastUpdate } from "@/checkup/lib/holdingsLastUpdate";

export const REFRESH_COOLDOWN = 30 * 60 * 1000; // 30 minutes

/**
 * 持倉報價同步的深模組。
 *
 * 介面：呼叫端只需提供一個 deps ref（內容可在後續 render 補齊，
 * 因為所有 callback 皆在呼叫當下才讀取），即可取得
 * 「同步狀態 / 任務日誌 / 卡片級同步狀態 / 覆蓋率補抓」四組能力。
 *
 * depsRef.current = { isDemo, holdings, setHoldings, setSaved, enriched, refreshPrices }
 */
export function useHoldingsSync(depsRef) {
  const d = () => depsRef.current || {};

  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(() => {
    // 從 localStorage 讀取上次成功同步時間，讓 F5 後仍能顯示正確的「更新於」
    try { return readLastUpdate(null); } catch { return null; }
  });
  const [rtConnected, setRtConnected] = useState(false); // current_prices Realtime 連線狀態
  const [cooldownText, setCooldownText] = useState("");
  // 任務日誌：{ id, ts, task, status, attempt, detail } — 用於下載排錯
  const [syncLog, setSyncLog] = useState([]);
  // 持倉覆蓋率彈窗（補抓報告）
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [coverageReport, setCoverageReport] = useState(null); // { requested, fetched, missingRows }
  const [backfilling, setBackfilling] = useState(false);
  // 立即同步排程（呼叫 stock-price-sync edge function）
  const [serverSyncing, setServerSyncing] = useState(false);
  // H4/H5 recompute UI：換價 / 排程失敗時的持久錯誤訊息（附「重試」按鈕）
  const [syncError, setSyncError] = useState(null);
  const [syncCopyState, setSyncCopyState] = useState(''); // '' | 'copied'
  // 連續多次失敗計數（跨 triggerServerSync 呼叫）
  const consecutiveFailRef = useRef(0);
  // debounce：連續快速觸發時只執行最後一次
  const debounceTimerRef = useRef(null);
  const inflightRef = useRef(false);
  // 每張卡片的獨立 sync 狀態：{ [code]: { syncing?: bool, error?: string } }
  const [holdingSyncStates, setHoldingSyncStates] = useState({});

  const appendLog = useCallback((entry) => {
    setSyncLog(prev => {
      const next = [{ id: Date.now() + Math.random(), ts: new Date().toISOString(), ...entry }, ...prev];
      return next.slice(0, 200); // 最多保留 200 筆
    });
  }, []);

  const syncLogRef = useRef(syncLog);
  syncLogRef.current = syncLog;

  const downloadSyncLog = useCallback(() => {
    const log = syncLogRef.current;
    const lines = [
      `# Free Checkup 同步任務日誌 (${new Date().toLocaleString('zh-TW')})`,
      `# 共 ${log.length} 筆事件`,
      '',
      ...log.map(e => `[${e.ts}] ${e.task} | ${e.status}${e.attempt ? ` | 嘗試 ${e.attempt}` : ''}${e.detail ? ` | ${e.detail}` : ''}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freecheckup-sync-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // 標記所有卡片為 syncing / 清除 sync 狀態（走 holdingSyncStates，不動 holdings 以保持 memo）
  const markCardsSyncing = useCallback((codes) => {
    setHoldingSyncStates(prev => {
      const next = { ...prev };
      const list = Array.isArray(codes) && codes.length
        ? codes
        : (d().holdings || []).map(h => h.code);
      list.forEach(code => {
        next[code] = { syncing: true, error: null };
      });
      return next;
    });
  }, []);

  const setCardSyncResult = useCallback((code, patch) => {
    setHoldingSyncStates(prev => ({ ...prev, [code]: { syncing: false, error: null, ...patch } }));
  }, []);

  const clearAllCardSync = useCallback((opts = {}) => {
    const { keepErrors = false } = opts;
    setHoldingSyncStates(prev => {
      const next = {};
      Object.keys(prev).forEach(code => {
        if (keepErrors && prev[code]?.error) next[code] = { syncing: false, error: prev[code].error };
      });
      return next;
    });
  }, []);

  // 立即觸發後端排程：stock-price-sync（實際執行邏輯）
  const triggerServerSyncNow = useCallback(async () => {
    const { isDemo, holdings, setHoldings, setSaved, refreshPrices } = d();
    if (inflightRef.current) return;
    inflightRef.current = true;
    setSyncError(null);
    setSyncCopyState('');
    // demo path
    if (isDemo) {
      setServerSyncing(true);
      markCardsSyncing();
      try { window.__demoSyncCount = (window.__demoSyncCount || 0) + 1; } catch {}
      await demoDelay(1500, 2800);
      let demoShouldFail = false;
      let demoMarketOpen = false;
      let demoPartialFail = false;
      try {
        const sp = new URLSearchParams(window.location.search);
        const errFlag = sp.get('demoSyncError');
        if (errFlag === '1' || errFlag === 'sticky') {
          demoShouldFail = true;
          // sticky: 保留 flag，讓連續重試都會失敗（用來測試 exhausted / 退避提示）
          if (errFlag !== 'sticky') {
            sp.delete('demoSyncError');
            const qs = sp.toString();
            window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
          }
        }
        if (sp.get('demoMarketOpen') === '1') demoMarketOpen = true;
        if (sp.get('demoPartialFail') === '1') demoPartialFail = true;
      } catch {}
      if (demoShouldFail) {
        clearAllCardSync();
        consecutiveFailRef.current += 1;
        setServerSyncing(false);
        setSyncError({
          message: '報價同步失敗：模擬網路錯誤，請按「重試」再試一次',
          httpStatus: 0,
          rawMessage: 'demoSyncError=1 flag triggered simulated failure',
          attempts: 1,
          exhausted: consecutiveFailRef.current >= 3,
        });
        inflightRef.current = false;
        return;
      }
      // 先根據當前 holdings 決定每張卡片的成功/失敗，再一次 setState
      const currentHoldings = holdings || [];
      const failedCodes = [];
      const results = currentHoldings.map((h, idx) => {
        const base = Number(h.price ?? h.cost) || 0;
        if (!base) return { code: h.code, next: h, fail: false };
        const shouldFailCard = demoPartialFail && (idx % 3 === 1);
        if (shouldFailCard) {
          failedCodes.push(h.code);
          return { code: h.code, next: h, fail: true };
        }
        const delta = (Math.random() * 0.03 - 0.015);
        const newPrice = Math.max(0.01, +(base * (1 + delta)).toFixed(2));
        const yesterday = Number.isFinite(Number(h.yesterday)) && Number(h.yesterday) > 0
          ? Number(h.yesterday) : null;
        const quote = demoMarketOpen
          ? { price: newPrice, source: 'live', updatedAt: new Date().toISOString() }
          : { price: newPrice, yesterday, source: 'live', updatedAt: new Date().toISOString() };
        return { code: h.code, next: normalizeHoldingMetrics(h, quote), fail: false };
      });
      setHoldings?.(results.map(r => r.next));
      setHoldingSyncStates(prev => {
        const next = { ...prev };
        results.forEach(r => {
          next[r.code] = r.fail
            ? { syncing: false, error: '個股報價 recompute 失敗（DEMO 模擬）' }
            : { syncing: false, error: null };
        });
        return next;
      });
      setLastUpdate(new Date());
      if (failedCodes.length) {
        setSyncError({
          message: `部分個股 recompute 失敗（${failedCodes.length} 檔）：${failedCodes.slice(0, 5).join('、')}`,
          httpStatus: 207,
          rawMessage: `partial-fail codes=${failedCodes.join(',')}`,
          attempts: 1,
          partial: true,
          failedCodes,
        });
      } else {
        setSaved?.('✅ DEMO 模擬報價已更新');
        setTimeout(() => setSaved?.(''), 3000);
        consecutiveFailRef.current = 0;
      }
      setServerSyncing(false);
      inflightRef.current = false;
      return;
    }
    // real path
    setServerSyncing(true);
    markCardsSyncing();
    appendLog({ task: 'server-sync', status: 'start', detail: '呼叫 stock-price-sync edge function' });
    const MAX = 3;
    // 退避重試：1s / 3s / 5s
    const BACKOFF_MS = [1000, 3000, 5000];
    let lastErr = '';
    let lastStatus = 0;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_FN_BASE}/stock-price-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        lastStatus = res.status;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        appendLog({
          task: 'server-sync', status: 'ok', attempt,
          detail: `symbols=${data.symbols ?? '?'} fetched=${data.prices_fetched ?? '?'}`
        });
        setSaved?.(`✅ 排程已執行：拉取 ${data.prices_fetched ?? 0} 檔報價`);
        setTimeout(() => setSaved?.(''), 4000);
        setLastUpdate(null);
        setTimeout(() => { d().refreshPrices?.()?.catch?.(() => {}); }, 800);
        clearAllCardSync();
        consecutiveFailRef.current = 0;
        setServerSyncing(false);
        inflightRef.current = false;
        return;
      } catch (e) {
        lastErr = e?.message || '網路錯誤';
        appendLog({ task: 'server-sync', status: 'retry', attempt, detail: lastErr });
        if (attempt < MAX) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt - 1] || 5000));
      }
    }
    appendLog({ task: 'server-sync', status: 'error', detail: `所有重試失敗：${lastErr}` });
    consecutiveFailRef.current += 1;
    const exhausted = consecutiveFailRef.current >= 3;
    setSyncError({
      message: exhausted
        ? `報價同步已連續失敗 ${consecutiveFailRef.current} 次，請重新整理頁面或稍後再試`
        : `報價同步失敗：${lastErr}（已重試 ${MAX} 次）`,
      httpStatus: lastStatus,
      rawMessage: lastErr,
      attempts: MAX,
      exhausted,
    });
    setSaved?.(`✕ 排程失敗：${lastErr}`);
    setTimeout(() => setSaved?.(''), 5000);
    clearAllCardSync();
    setServerSyncing(false);
    inflightRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendLog, markCardsSyncing, clearAllCardSync]);

  // 對外入口：debounced 250ms，連續快速點擊只執行最後一次
  const triggerServerSync = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      triggerServerSyncNow().catch(() => {});
    }, 250);
  }, [triggerServerSyncNow]);

  // 補齊報價：對缺價持倉一次性補抓，完成後僅在仍有失敗時開報告彈窗
  const runBackfillReport = useCallback(async () => {
    const { isDemo, setSaved, enriched, refreshPrices } = d();
    if (backfilling) return;
    const missingHoldings = (enriched || []).filter(h => !h.priceSource || h.priceError);
    if (missingHoldings.length === 0) {
      setSaved?.('✓ 報價已齊，無需補抓');
      setTimeout(() => setSaved?.(''), 2500);
      return;
    }
    if (isDemo) {
      setSaved?.('DEMO 模式不執行補抓，登入後可使用');
      setTimeout(() => setSaved?.(''), 3000);
      return;
    }
    setBackfilling(true);
    const codes = missingHoldings.map(h => String(h.code || '').trim()).filter(Boolean);
    appendLog({ task: 'backfill', status: 'start', detail: `symbols=${codes.length}` });
    try {
      const { data, error } = await supabase.functions.invoke('stock-price-sync', {
        body: { symbols: codes, force: true },
      });
      if (error) throw error;
      const reasons = data?.reasons || {};
      const missing = Array.isArray(data?.missing) ? data.missing : [];
      // 重抓本地持倉
      try { await refreshPrices?.(); } catch {}

      if (missing.length === 0) {
        setSaved?.(`✓ 全部補齊（${codes.length} 檔）`);
        setTimeout(() => setSaved?.(''), 3500);
        appendLog({ task: 'backfill', status: 'ok', detail: `fetched=${data?.fetched ?? 0}/${codes.length}` });
      } else {
        const missingRows = missing.map(code => {
          const h = missingHoldings.find(x => x.code === code) || {};
          return {
            code,
            name: h.name || '—',
            type: h.type || '—',
            reason: reasons[code] || 'unknown',
          };
        });
        setCoverageReport({
          requested: codes.length,
          fetched: (data?.fetched ?? 0),
          missingRows,
        });
        setCoverageOpen(true);
        appendLog({ task: 'backfill', status: 'partial', detail: `missing=${missing.length}/${codes.length}` });
      }
    } catch (e) {
      const msg = e?.message || '網路錯誤';
      setSaved?.(`✕ 補抓失敗：${msg}`);
      setTimeout(() => setSaved?.(''), 4500);
      appendLog({ task: 'backfill', status: 'error', detail: msg });
    } finally {
      setBackfilling(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backfilling, appendLog]);

  // Countdown timer for refresh cooldown
  useEffect(() => {
    if (!lastUpdate) { setCooldownText(""); return; }
    const tick = () => {
      const elapsed = Date.now() - lastUpdate.getTime();
      const remaining = REFRESH_COOLDOWN - elapsed;
      if (remaining <= 0) { setCooldownText(""); return; }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCooldownText(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdate]);

  return {
    refreshing, setRefreshing,
    lastUpdate, setLastUpdate,
    rtConnected, setRtConnected,
    cooldownText,
    syncLog, setSyncLog, appendLog, downloadSyncLog,
    coverageOpen, setCoverageOpen,
    coverageReport, setCoverageReport,
    backfilling, setBackfilling,
    serverSyncing, setServerSyncing,
    syncError, setSyncError,
    syncCopyState, setSyncCopyState,
    consecutiveFailRef, inflightRef, debounceTimerRef,
    holdingSyncStates, setHoldingSyncStates,
    markCardsSyncing, setCardSyncResult, clearAllCardSync,
    triggerServerSync, triggerServerSyncNow, runBackfillReport,
    REFRESH_COOLDOWN,
  };
}
