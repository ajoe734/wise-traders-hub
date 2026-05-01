/**
 * Portfolio Store
 *
 * Manages portfolio state using Zustand.
 *
 * 3A.1 接線重點：
 *  - 5 個 state（portfolios / activePortfolioId / viewMode / portfolioSwitching /
 *    showPortfolioManager）統一在這裡管，由 usePortfolioManagement 接上。
 *  - setActivePortfolioId / setViewMode 會同步通知 syncEngine.setContext(...)，
 *    確保 sentinel UUID gating（owner + portfolio mode 才寫雲端）即時生效，
 *    避免 demo 模式 / 非 owner 切換時誤觸雲端寫入。
 *  - 不接管 T+0 計算（marketPriceCache → holdings 套用仍走原路徑）。
 */

import { create } from 'zustand';
import { OWNER_PORTFOLIO_ID, PORTFOLIO_VIEW_MODE } from '../constants.js';
import { syncEngine } from '../lib/syncEngine.js';

// Initial state
const createInitialState = () => ({
  portfolios: [],
  activePortfolioId: OWNER_PORTFOLIO_ID,
  viewMode: PORTFOLIO_VIEW_MODE,
  portfolioSwitching: false,
  showPortfolioManager: false,
});

function pushSyncContext(state) {
  try {
    syncEngine.setContext({
      activePortfolioId: state.activePortfolioId,
      viewMode: state.viewMode,
    });
  } catch {
    /* syncEngine 尚未初始化或非瀏覽器環境時忽略 */
  }
}

export const usePortfolioStore = create((set, get) => ({
  // State
  ...createInitialState(),

  // Actions - Portfolios
  setPortfolios: (portfolios) => {
    const next = typeof portfolios === 'function' ? portfolios(get().portfolios) : portfolios;
    set({ portfolios: next });
  },

  // Actions - Active Portfolio
  setActivePortfolioId: (activePortfolioId) => {
    const next =
      typeof activePortfolioId === 'function'
        ? activePortfolioId(get().activePortfolioId)
        : activePortfolioId;
    set({ activePortfolioId: next });
    pushSyncContext(get());
  },

  // Actions - View Mode
  setViewMode: (viewMode) => {
    const next = typeof viewMode === 'function' ? viewMode(get().viewMode) : viewMode;
    set({ viewMode: next });
    pushSyncContext(get());
  },

  // Actions - UI State
  setPortfolioSwitching: (portfolioSwitching) => {
    const next =
      typeof portfolioSwitching === 'function'
        ? portfolioSwitching(get().portfolioSwitching)
        : portfolioSwitching;
    set({ portfolioSwitching: next });
  },
  setShowPortfolioManager: (showPortfolioManager) => {
    const next =
      typeof showPortfolioManager === 'function'
        ? showPortfolioManager(get().showPortfolioManager)
        : showPortfolioManager;
    set({ showPortfolioManager: next });
  },

  // 一次性初始化（只在 store 還是預設值時套用）
  hydrateInitial: ({ portfolios, activePortfolioId, viewMode } = {}) => {
    const current = get();
    const patch = {};
    if (Array.isArray(portfolios) && current.portfolios.length === 0) {
      patch.portfolios = portfolios;
    }
    if (
      typeof activePortfolioId === 'string' &&
      current.activePortfolioId === OWNER_PORTFOLIO_ID
    ) {
      patch.activePortfolioId = activePortfolioId;
    }
    if (typeof viewMode === 'string' && current.viewMode === PORTFOLIO_VIEW_MODE) {
      patch.viewMode = viewMode;
    }
    if (Object.keys(patch).length) {
      set(patch);
      pushSyncContext(get());
    }
  },

  // Selectors
  getActivePortfolio: () => {
    const { portfolios, activePortfolioId } = get();
    return portfolios.find((p) => p.id === activePortfolioId);
  },

  getPortfolioById: (id) => {
    const { portfolios } = get();
    return portfolios.find((p) => p.id === id);
  },

  getPortfolioCount: () => {
    const { portfolios } = get();
    return portfolios.length;
  },

  // Reset
  reset: () => {
    set(createInitialState());
    pushSyncContext(get());
  },
}));
