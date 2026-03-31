/**
 * Holdings Store
 * 
 * Manages holdings state using Zustand
 */

import { create } from 'zustand';

// Initial state
const createInitialState = () => ({
  holdings: [],
  watchlist: [],
  targets: {},
  fundamentals: {},
  analystReports: {},
  holdingDossiers: [],
  reversalConditions: {},
  scanQuery: '',
  scanFilter: '全部',
  sortBy: 'code',
  sortDir: 'asc',
  showReversal: false,
  attentionCount: 0,
  pendingCount: 0,
  targetUpdateCount: 0,
});

export const useHoldingsStore = create((set, get) => ({
  // State
  ...createInitialState(),
  
  // Actions - Holdings
  setHoldings: (holdings) => set({ holdings }),
  upsertHolding: (holding) => set((state) => {
    const idx = state.holdings.findIndex(h => h.code === holding.code);
    if (idx >= 0) {
      const next = [...state.holdings];
      next[idx] = holding;
      return { holdings: next };
    }
    return { holdings: [...state.holdings, holding] };
  }),
  removeHolding: (code) => set((state) => ({
    holdings: state.holdings.filter(h => h.code !== code)
  })),
  
  // Actions - Watchlist
  setWatchlist: (watchlist) => set({ watchlist }),
  upsertWatchlist: (item) => set((state) => {
    const idx = state.watchlist.findIndex(w => w.code === item.code);
    if (idx >= 0) {
      const next = [...state.watchlist];
      next[idx] = item;
      return { watchlist: next };
    }
    return { watchlist: [...state.watchlist, item] };
  }),
  removeWatchlist: (code) => set((state) => ({
    watchlist: state.watchlist.filter(w => w.code !== code)
  })),
  
  // Actions - Targets
  setTargets: (targets) => set({ targets }),
  updateTargetPrice: (code, targetPrice) => set((state) => ({
    targets: { ...state.targets, [code]: { targetPrice, updatedAt: new Date().toISOString() } }
  })),
  
  // Actions - Fundamentals
  setFundamentals: (fundamentals) => set({ fundamentals }),
  upsertFundamentals: (code, entry) => set((state) => ({
    fundamentals: { ...state.fundamentals, [code]: entry }
  })),
  
  // Actions - Analyst Reports
  setAnalystReports: (analystReports) => set({ analystReports }),
  
  // Actions - Dossiers
  setHoldingDossiers: (holdingDossiers) => set({ holdingDossiers }),
  
  // Actions - Reversal
  setReversalConditions: (reversalConditions) => set({ reversalConditions }),
  updateReversal: (code, condition) => set((state) => ({
    reversalConditions: { ...state.reversalConditions, [code]: condition }
  })),
  
  // Actions - Scan
  setScanQuery: (scanQuery) => set({ scanQuery }),
  setScanFilter: (scanFilter) => set({ scanFilter }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortDir: (sortDir) => set({ sortDir }),
  setShowReversal: (showReversal) => set({ showReversal }),
  
  // Actions - Counts
  setAttentionCount: (attentionCount) => set({ attentionCount }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setTargetUpdateCount: (targetUpdateCount) => set({ targetUpdateCount }),
  
  // Selectors
  getHoldingByCode: (code) => {
    const { holdings } = get();
    return holdings.find(h => h.code === code);
  },
  
  getHoldingsSummary: () => {
    const { holdings } = get();
    const totalValue = holdings.reduce((sum, h) => sum + (h.value || 0), 0);
    const totalCost = holdings.reduce((sum, h) => sum + (h.cost || 0) * (h.qty || 0), 0);
    const totalPnl = totalValue - totalCost;
    const totalRetPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    
    return {
      totalValue,
      totalCost,
      totalPnl,
      totalRetPct,
      count: holdings.length,
    };
  },
  
  getTopGainers: (limit = 5) => {
    const { holdings } = get();
    return [...holdings]
      .sort((a, b) => (b.pct || 0) - (a.pct || 0))
      .slice(0, limit);
  },
  
  getTopLosers: (limit = 5) => {
    const { holdings } = get();
    return [...holdings]
      .sort((a, b) => (a.pct || 0) - (b.pct || 0))
      .slice(0, limit);
  },
  
  getTop5: () => {
    const { holdings } = get();
    return [...holdings]
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 5);
  },
  
  getHoldingsWithAlerts: () => {
    const { holdings } = get();
    return holdings.filter(h => h.alert && h.alert.trim() !== '');
  },
  
  getHoldingsMissingPrices: () => {
    const { holdings } = get();
    return holdings.filter(h => h.integrityIssue === 'missing-price');
  },
  
  // Reset
  reset: () => set(createInitialState()),
}));
