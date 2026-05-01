/**
 * Holdings Store
 *
 * Manages holdings state using Zustand.
 *
 * IMPORTANT: holdings/tradeLog/targets/... default to `null` (not [] / {}).
 * `null` is the "not yet hydrated" sentinel used by usePortfolioPersistence
 * and useAppRuntimeCoreLifecycle to distinguish "no data loaded" from
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

// Functional setter — supports both setX(value) and setX(prev => next),
// matching React's useState contract so call sites don't have to change.
const makeSetter = (key) => (set) => (next) =>
  set((state) =>
    typeof next === 'function' ? { [key]: next(state[key]) } : { [key]: next }
  );

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
  upsertHolding: (holding) => set((state) => {
    const list = asArr(state.holdings);
    const idx = list.findIndex(h => h.code === holding.code);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = holding;
      return { holdings: next };
    }
    return { holdings: [...list, holding] };
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

  getHoldingsSummary: () => {
    const list = asArr(get().holdings);
    const totalValue = list.reduce((sum, h) => sum + (h.value || 0), 0);
    const totalCost = list.reduce((sum, h) => sum + (h.cost || 0) * (h.qty || 0), 0);
    const totalPnl = totalValue - totalCost;
    const totalRetPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    return { totalValue, totalCost, totalPnl, totalRetPct, count: list.length };
  },

  getTopGainers: (limit = 5) =>
    [...asArr(get().holdings)].sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, limit),

  getTopLosers: (limit = 5) =>
    [...asArr(get().holdings)].sort((a, b) => (a.pct || 0) - (b.pct || 0)).slice(0, limit),

  getTop5: () =>
    [...asArr(get().holdings)].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 5),

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
