/**
 * Reports Store
 * 
 * Manages reports and analysis history state using Zustand
 */

import { create } from 'zustand';

// Initial state
const createInitialState = () => ({
  analysisHistory: [],
  dailyReport: null,
  dailyExpanded: false,
  reportRefreshing: false,
  reportRefreshMeta: {},
  reportRefreshStatus: '',
  researching: false,
  researchTarget: null,
  researchResults: null,
  researchHistory: [],
  enrichingResearchCode: null,
  stressResult: null,
  stressTesting: false,
  analyzeStep: '',
  analyzing: false,
});

export const useReportsStore = create((set, get) => ({
  // State
  ...createInitialState(),
  
  // Actions - Analysis History
  setAnalysisHistory: (analysisHistory) => set({ analysisHistory }),
  addAnalysis: (analysis) => set((state) => ({
    analysisHistory: [analysis, ...state.analysisHistory.filter(a => a.id !== analysis.id)].slice(0, 30)
  })),
  deleteAnalysis: (reportId) => set((state) => ({
    analysisHistory: state.analysisHistory.filter(a => a.id !== reportId)
  })),
  
  // Actions - Daily Report
  setDailyReport: (dailyReport) => set({ dailyReport }),
  setDailyExpanded: (dailyExpanded) => set({ dailyExpanded }),
  
  // Actions - Refresh
  setReportRefreshing: (reportRefreshing) => set({ reportRefreshing }),
  setReportRefreshMeta: (reportRefreshMeta) => set({ reportRefreshMeta }),
  setReportRefreshStatus: (reportRefreshStatus) => set({ reportRefreshStatus }),
  
  // Actions - Research
  setResearching: (researching) => set({ researching }),
  setResearchTarget: (researchTarget) => set({ researchTarget }),
  setResearchResults: (researchResults) => set({ researchResults }),
  setResearchHistory: (researchHistory) => set({ researchHistory }),
  setEnrichingResearchCode: (enrichingResearchCode) => set({ enrichingResearchCode }),
  
  // Actions - Stress Test
  setStressResult: (stressResult) => set({ stressResult }),
  setStressTesting: (stressTesting) => set({ stressTesting }),
  setAnalyzeStep: (analyzeStep) => set({ analyzeStep }),
  setAnalyzing: (analyzing) => set({ analyzing }),
  
  // Selectors
  getLatestAnalysis: () => {
    const { analysisHistory } = get();
    return analysisHistory[0] || null;
  },
  
  getAnalysisCount: () => {
    const { analysisHistory } = get();
    return analysisHistory.length;
  },
  
  getReportRefreshLimitStatus: () => {
    const { reportRefreshMeta } = get();
    const todayCount = reportRefreshMeta.todayCount || 0;
    const dailyLimit = 5;
    return {
      used: todayCount,
      remaining: Math.max(0, dailyLimit - todayCount),
      limit: dailyLimit,
      exhausted: todayCount >= dailyLimit,
    };
  },
  
  // Reset
  reset: () => set(createInitialState()),
}));
