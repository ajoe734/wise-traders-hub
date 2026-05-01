/**
 * Strategy Brain Store
 *
 * Manages strategy brain state using Zustand.
 * `strategyBrain` defaults to null (sentinel for "not yet hydrated").
 * `brainValidation` uses createEmptyBrainValidationStore() to guarantee schema.
 */

import { create } from 'zustand';
import { createEmptyBrainValidationStore } from '../lib/brainRuntime.js';

// Functional setter — supports both setX(value) and setX(prev => next),
// matching React's useState contract.
const makeSetter = (key) => (set) => (next) =>
  set((state) =>
    typeof next === 'function' ? { [key]: next(state[key]) } : { [key]: next }
  );

// Initial state
const createInitialState = () => ({
  strategyBrain: null,
  brainValidation: createEmptyBrainValidationStore(),
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

  // Actions - Brain (functional-update aware)
  setStrategyBrain: makeSetter('strategyBrain')(set),
  updateStrategyBrain: (updates) => set((state) => ({
    strategyBrain: { ...state.strategyBrain, ...updates },
  })),

  // Actions - Validation (functional-update aware)
  setBrainValidation: makeSetter('brainValidation')(set),
  addValidationCase: (newCase) => set((state) => {
    const cases = state.brainValidation?.cases || [];
    const exists = cases.some(c => c?.id === newCase.id);
    if (exists) return state;
    return {
      brainValidation: {
        ...state.brainValidation,
        cases: [...cases, newCase].slice(-240),
      },
    };
  }),

  // Actions - Audit
  setBrainAudit: (brainAudit) => set({ brainAudit }),
  updateBrainAudit: (auditUpdate) => set((state) => ({
    brainAudit: { ...state.brainAudit, ...auditUpdate },
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
    const cases = brainValidation?.cases || [];
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

  // One-time hydration — seeds strategyBrain only if still null;
  // brainValidation is patched only when current store has zero cases.
  hydrateInitial: (data = {}) => set((state) => {
    const next = {};
    if (state.strategyBrain == null && data.strategyBrain !== undefined) {
      next.strategyBrain = data.strategyBrain;
    }
    if (
      data.brainValidation !== undefined &&
      (!state.brainValidation || (state.brainValidation.cases || []).length === 0)
    ) {
      next.brainValidation = data.brainValidation;
    }
    return next;
  }),

  // Reset
  reset: () => set(createInitialState()),
}));
