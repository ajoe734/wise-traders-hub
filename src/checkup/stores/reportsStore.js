/**
 * Reports Store
 *
 * Manages reports / research / async-flag state using Zustand.
 *
 * IMPORTANT: `analysisHistory` and `researchHistory` default to `null`
 * (sentinel for "not yet hydrated") to align with persistence semantics.
 * Selectors below tolerate null via `asArr`.
 */

import { create } from 'zustand';

const asArr = (v) => (Array.isArray(v) ? v : []);

// Functional setter — supports both setX(value) and setX(prev => next),
// matching React's useState contract.
const makeSetter = (key) => (set) => (next) =>
  set((state) =>
    typeof next === 'function' ? { [key]: next(state[key]) } : { [key]: next }
  );

// Initial state
const createInitialState = () => ({
  analysisHistory: null,
  dailyReport: null,
  dailyExpanded: false,
  reportRefreshing: false,
  reportRefreshMeta: {},
  reportRefreshStatus: '',
  researching: false,
  researchTarget: null,
  researchResults: null,
  researchHistory: null,
  enrichingResearchCode: null,
  stressResult: null,
  stressTesting: false,
  analyzeStep: '',
  analyzing: false,
});

export const useReportsStore = create((set, get) => ({
  // State
  ...createInitialState(),

  // Actions - Analysis History (functional-update aware)
  setAnalysisHistory: makeSetter('analysisHistory')(set),
  addAnalysis: (analysis) => set((state) => ({
    analysisHistory: [
      analysis,
      ...asArr(state.analysisHistory).filter(a => a.id !== analysis.id),
    ].slice(0, 30),
  })),
  deleteAnalysis: (reportId) => set((state) => ({
    analysisHistory: asArr(state.analysisHistory).filter(a => a.id !== reportId),
  })),

  // Actions - Daily Report
  setDailyReport: makeSetter('dailyReport')(set),
  setDailyExpanded: (dailyExpanded) => set({ dailyExpanded }),

  // Actions - Refresh
  setReportRefreshing: (reportRefreshing) => set({ reportRefreshing }),
  setReportRefreshMeta: makeSetter('reportRefreshMeta')(set),
  setReportRefreshStatus: (reportRefreshStatus) => set({ reportRefreshStatus }),

  // Actions - Research
  setResearching: makeSetter('researching')(set),
  setResearchTarget: (researchTarget) => set({ researchTarget }),
  setResearchResults: (researchResults) => set({ researchResults }),
  setResearchHistory: makeSetter('researchHistory')(set),
  setEnrichingResearchCode: (enrichingResearchCode) => set({ enrichingResearchCode }),

  // Actions - Stress Test / Async flags
  setStressResult: (stressResult) => set({ stressResult }),
  setStressTesting: (stressTesting) => set({ stressTesting }),
  setAnalyzeStep: makeSetter('analyzeStep')(set),
  setAnalyzing: makeSetter('analyzing')(set),

  // Selectors (null-tolerant)
  getLatestAnalysis: () => {
    const list = asArr(get().analysisHistory);
    return list[0] || null;
  },

  getAnalysisCount: () => asArr(get().analysisHistory).length,

  getReportRefreshLimitStatus: () => {
    const { reportRefreshMeta } = get();
    const todayCount = reportRefreshMeta?.todayCount || 0;
    const dailyLimit = 5;
    return {
      used: todayCount,
      remaining: Math.max(0, dailyLimit - todayCount),
      limit: dailyLimit,
      exhausted: todayCount >= dailyLimit,
    };
  },

  // One-time hydration — only seeds keys that are still in the unhydrated state.
  hydrateInitial: (data = {}) => set((state) => {
    const next = {};
    if (state.analysisHistory == null && data.analysisHistory !== undefined) {
      next.analysisHistory = data.analysisHistory;
    }
    if (state.dailyReport == null && data.dailyReport !== undefined) {
      next.dailyReport = data.dailyReport;
    }
    if (state.researchHistory == null && data.researchHistory !== undefined) {
      next.researchHistory = data.researchHistory;
    }
    return next;
  }),

  // Reset
  reset: () => set(createInitialState()),
}));
