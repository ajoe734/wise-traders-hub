/**
 * Market Data Store
 * 
 * Manages market price cache and sync state using Zustand
 */

import { create } from 'zustand';
import { createEmptyMarketPriceCache } from '../lib/market.js';
import { mergeAuthoritativeIntoPriceCache } from '../lib/authoritativePriceMirror';


// Initial state
const createInitialState = () => ({
  marketPriceCache: createEmptyMarketPriceCache(),
  marketPriceSync: null,
  refreshing: false,
  lastUpdate: null,
});

export const useMarketDataStore = create((set, get) => ({
  // State
  ...createInitialState(),
  
  // Actions - Cache
  setMarketPriceCache: (marketPriceCache) => set({ marketPriceCache }),
  
  // Actions - Sync
  setMarketPriceSync: (marketPriceSync) => set({ marketPriceSync }),
  
  // Actions - UI State
  setRefreshing: (refreshing) => set({ refreshing }),
  setLastUpdate: (lastUpdate) => set({ lastUpdate }),
  
  // Selectors — Phase 7：一律先讀 DB 權威價鏡像，legacy 快取只當 fallback。
  getPriceForCode: (code) => {
    const { marketPriceCache } = get();
    const merged = mergeAuthoritativeIntoPriceCache(marketPriceCache);
    return merged?.prices?.[code]?.price || null;
  },

  getPriceStatus: (code) => {
    const { marketPriceCache } = get();
    const merged = mergeAuthoritativeIntoPriceCache(marketPriceCache);
    const quote = merged?.prices?.[code];
    if (!quote) return 'flat';
    const change = quote.change || 0;
    if (change > 0) return 'up';
    if (change < 0) return 'down';
    return 'flat';
  },

  
  getSyncStatus: () => {
    const { marketPriceSync } = get();
    if (!marketPriceSync) return '未同步';
    if (marketPriceSync.status === 'failed') return '同步失敗';
    if (marketPriceSync.status === 'partial') return '部分成功';
    if (marketPriceSync.status === 'success') return '已同步';
    return '未同步';
  },
  
  getSyncStatusTone: () => {
    const { marketPriceSync } = get();
    if (!marketPriceSync) return '#888';
    if (marketPriceSync.status === 'failed') return '#ef4444';
    if (marketPriceSync.status === 'partial') return '#f59e0b';
    if (marketPriceSync.status === 'success') return '#22c55e';
    return '#888';
  },
  
  // Reset
  reset: () => set(createInitialState()),
}));
