/**
 * Holdings Store
 *
 * Manages holdings state using Zustand.
 *
 * IMPORTANT: holdings/tradeLog/targets/... default to `null` (not [] / {}).
 * `null` is the "not yet hydrated" sentinel used by usePortfolioPersistence
 * to distinguish "no data loaded" from
 * "loaded empty". Do NOT change without auditing those hooks.
 */

import { create } from 'zustand';

const createInitialState = () => ({
  holdings: null,
  tradeLog: null,
  watchlist: null,
  targets: null,
  fundamentals: null,
  analystReports: null,
  reportRefreshMeta: null,
  holdingDossiers: null,
  reversalConditions: null,
  // UI scan state — keep concrete defaults
  scanQuery: '',
  scanFilter: '全部',
  sortBy: 'code',
  sortDir: 'asc',
  showReversal: false,
  attentionCount: 0,
  pendingCount: 0,
  targetUpdateCount: 0,
});

// Helpers — tolerate null because slices start as null until bootstrap hydrates
const asArr = (v) => (Array.isArray(v) ? v : []);
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// H15 (audit 2026-06): WeakMap 快取 — key 為 holdings 陣列 reference
// store 沒換陣列 = 同一份結果，避免每次呼叫 selector 重複 spread+sort。
const _summaryCache = new WeakMap();
const _gainersCache = new WeakMap();
const _losersCache = new WeakMap();
const _top5Cache = new WeakMap();
function _getOrCompute(cache, key, compute) {
  if (!key || typeof key !== 'object') return compute();
  if (cache.has(key)) return cache.get(key);
  const v = compute();
  cache.set(key, v);
  return v;
}
function _topByPct(cache, list, limit, dir) {
  const bucket = _getOrCompute(cache, list, () => {
    const sorted = [...list].sort((a, b) => (dir === 'desc' ? (b.pct ?? 0) - (a.pct ?? 0) : (a.pct ?? 0) - (b.pct ?? 0)));
    return sorted;
  });
  return bucket.slice(0, limit);
}
function _top5ByValue(list) {
  const sorted = _getOrCompute(_top5Cache, list, () =>
    [...list].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  );
  return sorted.slice(0, 5);
}

// Functional setter — supports both setX(value) and setX(prev => next),
// matching React's useState contract so call sites don't have to change.
//
// C2（holdings audit 2026-06）：hydration sentinel 保護。
//   slice 預設為 `null`（= 未 hydrate）。tick-path（quote tick 等）updater 多半假設
//   prev 是陣列/物件，遇到 null sentinel 會丟 TypeError 或沉默地把 sentinel 變成 `[]`，
//   使後續 usePortfolioPersistence 把「未載入」誤判為「載入後空」。
//   策略：try/catch 包住 updater：
//     - 正常 updater（如 useTransientUiActions 用 `prev || {}` 防呆）→ 直接寫入，正常初始化
//     - 拋錯的 updater（tick callback 假設陣列）+ prev==null → 保留 sentinel，等真正 hydrate
const makeSetter = (key) => (set) => (next) =>
  set((state) => {
    if (typeof next !== 'function') return { [key]: next };
    const prev = state[key];
    try {
      return { [key]: next(prev) };
    } catch (err) {
      if (prev == null) return {}; // sentinel 保護
      throw err;
    }
  });

export const useHoldingsStore = create((set, get) => ({
  // State
  ...createInitialState(),

  // Slice setters (functional-update aware)
  setHoldings: makeSetter('holdings')(set),
  setTradeLog: makeSetter('tradeLog')(set),
  setWatchlist: makeSetter('watchlist')(set),
  setTargets: makeSetter('targets')(set),
  setFundamentals: makeSetter('fundamentals')(set),
  setAnalystReports: makeSetter('analystReports')(set),
  setReportRefreshMeta: makeSetter('reportRefreshMeta')(set),
  setHoldingDossiers: makeSetter('holdingDossiers')(set),
  setReversalConditions: makeSetter('reversalConditions')(set),

  // Granular actions — Holdings
  // H17 (audit 2026-06): 入口驗證 — 空 code / 非有限 qty / qty<=0 一律 no-op，
  //                       避免污染 store 後 derive 出 NaN/Infinity。
  upsertHolding: (holding) => set((state) => {
    const code = String(holding?.code || '').trim();
    const qty = Number(holding?.qty);
    if (!code || !Number.isFinite(qty) || qty <= 0) return {};
    const sanitized = {
      ...holding,
      code,
      qty,
      price: Math.max(0, Number(holding?.price) || 0),
    };
    const list = asArr(state.holdings);
    const idx = list.findIndex(h => h.code === code);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = sanitized;
      return { holdings: next };
    }
    return { holdings: [...list, sanitized] };
  }),
  removeHolding: (code) => set((state) => ({
    holdings: asArr(state.holdings).filter(h => h.code !== code),
  })),

  // Granular actions — Watchlist
  upsertWatchlist: (item) => set((state) => {
    const list = asArr(state.watchlist);
    const idx = list.findIndex(w => w.code === item.code);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = item;
      return { watchlist: next };
    }
    return { watchlist: [...list, item] };
  }),
  removeWatchlist: (code) => set((state) => ({
    watchlist: asArr(state.watchlist).filter(w => w.code !== code),
  })),

  // Granular actions — Targets / Fundamentals / Reversal
  updateTargetPrice: (code, targetPrice) => set((state) => ({
    targets: { ...asObj(state.targets), [code]: { targetPrice, updatedAt: new Date().toISOString() } },
  })),
  upsertFundamentals: (code, entry) => set((state) => ({
    fundamentals: { ...asObj(state.fundamentals), [code]: entry },
  })),
  updateReversal: (code, condition) => set((state) => ({
    reversalConditions: { ...asObj(state.reversalConditions), [code]: condition },
  })),

  // UI scan
  setScanQuery: (scanQuery) => set({ scanQuery }),
  setScanFilter: (scanFilter) => set({ scanFilter }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortDir: (sortDir) => set({ sortDir }),
  setShowReversal: (showReversal) => set({ showReversal }),

  // Counts
  setAttentionCount: (attentionCount) => set({ attentionCount }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setTargetUpdateCount: (targetUpdateCount) => set({ targetUpdateCount }),

  // Selectors (null-tolerant)
  getHoldingByCode: (code) => asArr(get().holdings).find(h => h.code === code) || null,

  // H15 (audit 2026-06)：getTop* / getHoldingsSummary 過去每次呼叫都 spread + sort，
  //   在 quote tick / re-render 熱路徑會浪費 O(n log n)。改用 WeakMap 以 holdings 陣列 reference
  //   作 key 快取結果；只要 store 沒換陣列（snapshot 未變）就回同一份結果。
  // H2 (audit 2026-06): `||` → `??`，pnl=0 不被當缺值。
  getHoldingsSummary: () => {
    const list = asArr(get().holdings);
    return _getOrCompute(_summaryCache, list, () => {
      const totalValue = list.reduce((sum, h) => sum + (h.value ?? 0), 0);
      const totalCost = list.reduce((sum, h) => sum + (h.cost ?? 0) * (h.qty ?? 0), 0);
      const totalPnl = totalValue - totalCost;
      const totalRetPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
      return { totalValue, totalCost, totalPnl, totalRetPct, count: list.length };
    });
  },

  getTopGainers: (limit = 5) =>
    _topByPct(_gainersCache, asArr(get().holdings), limit, 'desc'),

  getTopLosers: (limit = 5) =>
    _topByPct(_losersCache, asArr(get().holdings), limit, 'asc'),

  getTop5: () => _top5ByValue(asArr(get().holdings)),

  getHoldingsWithAlerts: () =>
    asArr(get().holdings).filter(h => h.alert && h.alert.trim() !== ''),

  getHoldingsMissingPrices: () =>
    asArr(get().holdings).filter(h => h.integrityIssue === 'missing-price'),

  // One-time hydration — only seeds keys that are still null (idempotent on remount)
  hydrateInitial: (data = {}) => set((state) => {
    const next = {};
    const keys = [
      'holdings', 'tradeLog', 'watchlist', 'targets', 'fundamentals',
      'analystReports', 'reportRefreshMeta', 'holdingDossiers', 'reversalConditions',
    ];
    for (const key of keys) {
      if (state[key] == null && data[key] !== undefined) next[key] = data[key];
    }
    return next;
  }),

  reset: () => set(createInitialState()),
}));
