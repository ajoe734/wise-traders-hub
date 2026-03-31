/**
 * Strategy Brain Store
 * 
 * Manages strategy brain state using Zustand
 */

import { create } from 'zustand';

// Initial state
const createInitialState = () => ({
  strategyBrain: null,
  brainValidation: { version: 1, cases: [] },
  brainAudit: {
    validatedRules: [],
    staleRules: [],
    invalidatedRules: [],
  },
  expandedStock: null,
  relayPlanExpanded: false,
});

export const useBrainStore = create((set, get) => ({
  // State
  ...createInitialState(),
  
  // Actions - Brain
  setStrategyBrain: (strategyBrain) => set({ strategyBrain }),
  updateStrategyBrain: (updates) => set((state) => ({
    strategyBrain: { ...state.strategyBrain, ...updates }
  })),
  
  // Actions - Validation
  setBrainValidation: (brainValidation) => set({ brainValidation }),
  addValidationCase: (newCase) => set((state) => {
    const cases = state.brainValidation.cases || [];
    const exists = cases.some(c => c?.id === newCase.id);
    if (exists) return state;
    return {
      brainValidation: {
        ...state.brainValidation,
        cases: [...cases, newCase].slice(-240),
      }
    };
  }),
  
  // Actions - Audit
  setBrainAudit: (brainAudit) => set({ brainAudit }),
  updateBrainAudit: (auditUpdate) => set((state) => ({
    brainAudit: { ...state.brainAudit, ...auditUpdate }
  })),
  
  // Actions - UI State
  setExpandedStock: (expandedStock) => set({ expandedStock }),
  setRelayPlanExpanded: (relayPlanExpanded) => set({ relayPlanExpanded }),
  
  // Selectors
  getBrainRulesByStatus: () => {
    const { strategyBrain } = get();
    if (!strategyBrain) return { active: [], candidate: [], archived: [] };
    
    const rules = strategyBrain.rules || [];
    return {
      active: rules.filter(r => r.status === 'active'),
      candidate: rules.filter(r => r.status === 'candidate'),
      archived: rules.filter(r => r.status === 'archived'),
    };
  },
  
  getValidationStats: () => {
    const { brainValidation } = get();
    const cases = brainValidation.cases || [];
    return {
      total: cases.length,
      supported: cases.filter(c => c.verdict === 'supported').length,
      contradicted: cases.filter(c => c.verdict === 'contradicted').length,
      mixed: cases.filter(c => c.verdict === 'mixed').length,
    };
  },
  
  getAuditStats: () => {
    const { brainAudit } = get();
    return {
      validated: brainAudit.validatedRules?.length || 0,
      stale: brainAudit.staleRules?.length || 0,
      invalidated: brainAudit.invalidatedRules?.length || 0,
    };
  },
  
  // Reset
  reset: () => set(createInitialState()),
}));
