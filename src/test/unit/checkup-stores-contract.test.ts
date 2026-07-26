/**
 * L3 · Store 契約測試
 *
 * 每顆 store 都要提供 route hook 消費端假設的 selector / setter key。
 * store 改名或欄位漏掉，會在這裡爆炸而不是等 e2e 白畫面才發現。
 */
import { describe, it, expect } from 'vitest'
import {
  useHoldingsStore,
  useMarketDataStore,
  useReportsStore,
  useEventStore,
  useBrainStore,
  usePortfolioStore,
} from '@/checkup/stores'

describe('L3 · store selector shape 契約', () => {
  it('holdingsStore 提供持倉/交易/目標/dossier + setter', () => {
    const s = useHoldingsStore.getState()
    for (const key of [
      'holdings',
      'tradeLog',
      'watchlist',
      'targets',
      'fundamentals',
      'reversalConditions',
      'setHoldings',
      'setTradeLog',
      'setTargets',
    ] as const) {
      expect(s, `holdingsStore missing key: ${key}`).toHaveProperty(key)
    }
  })

  it('marketStore 提供 marketPriceCache + refreshing 旗標', () => {
    const s = useMarketDataStore.getState()
    for (const key of ['marketPriceCache', 'refreshing', 'setMarketPriceCache', 'setRefreshing']) {
      expect(s, `marketStore missing key: ${key}`).toHaveProperty(key)
    }
  })

  it('reportsStore 提供 daily / analysis / research 三組 slice', () => {
    const s = useReportsStore.getState()
    for (const key of [
      'dailyReport',
      'analysisHistory',
      'researchHistory',
      'researching',
      'setDailyReport',
      'setAnalysisHistory',
      'setResearchHistory',
    ] as const) {
      expect(s, `reportsStore missing key: ${key}`).toHaveProperty(key)
    }
  })

  it('eventStore 提供 newsEvents + review form 預設值 (null 為 not-hydrated 哨兵)', () => {
    const s = useEventStore.getState()
    expect(s).toHaveProperty('newsEvents')
    // newsEvents 預設為 null（哨兵值），不是空陣列
    expect(s.newsEvents === null || Array.isArray(s.newsEvents)).toBe(true)
    expect(typeof s.setNewsEvents).toBe('function')
  })

  it('brainStore 提供 expandedStock / relayPlanExpanded 給跨模組展開', () => {
    const s = useBrainStore.getState()
    for (const key of [
      'strategyBrain',
      'expandedStock',
      'relayPlanExpanded',
      'setExpandedStock',
      'setRelayPlanExpanded',
    ] as const) {
      expect(s, `brainStore missing key: ${key}`).toHaveProperty(key)
    }
  })

  it('portfolioStore 提供 activePortfolioId / viewMode', () => {
    const s = usePortfolioStore.getState()
    for (const key of ['portfolios', 'activePortfolioId', 'viewMode'] as const) {
      expect(s, `portfolioStore missing key: ${key}`).toHaveProperty(key)
    }
  })
})
