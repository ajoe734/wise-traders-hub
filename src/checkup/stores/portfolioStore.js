/**
 * Portfolio Store
 * 
 * Manages portfolio state using Zustand
 */

import { create } from 'zustand';
import { OWNER_PORTFOLIO_ID, PORTFOLIO_VIEW_MODE } from '../constants.js';

// Initial state
const createInitialState = () => ({
  portfolios: [],
  activePortfolioId: OWNER_PORTFOLIO_ID,
  viewMode: PORTFOLIO_VIEW_MODE,
  portfolioSwitching: false,
  showPortfolioManager: false,
});

export const usePortfolioStore = create((set, get) => ({
  // State
  ...createInitialState(),
  
  // Actions - Portfolios
  setPortfolios: (portfolios) => set({ portfolios }),
  
  // Actions - Active Portfolio
  setActivePortfolioId: (activePortfolioId) => set({ activePortfolioId }),
  
  // Actions - View Mode
  setViewMode: (viewMode) => set({ viewMode }),
  
  // Actions - UI State
  setPortfolioSwitching: (portfolioSwitching) => set({ portfolioSwitching }),
  setShowPortfolioManager: (showPortfolioManager) => set({ showPortfolioManager }),
  
  // Selectors
  getActivePortfolio: () => {
    const { portfolios, activePortfolioId } = get();
    return portfolios.find(p => p.id === activePortfolioId);
  },
  
  getPortfolioById: (id) => {
    const { portfolios } = get();
    return portfolios.find(p => p.id === id);
  },
  
  getPortfolioCount: () => {
    const { portfolios } = get();
    return portfolios.length;
  },
  
  // Reset
  reset: () => set(createInitialState()),
}));
