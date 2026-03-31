import { useEffect } from 'react'

export function usePostCloseSelfHealSync({
  ready,
  viewMode,
  portfolioViewMode,
  shouldTriggerPostCloseSelfHeal,
  activePortfolioId,
  todayMarketClock,
  priceSelfHealRef,
  syncPostClosePrices,
}) {
  useEffect(() => {
    if (!ready || viewMode !== portfolioViewMode) return
    if (!shouldTriggerPostCloseSelfHeal) return

    const healKey = `${activePortfolioId}:${todayMarketClock.marketDate}`
    if (priceSelfHealRef.current[healKey]) return
    priceSelfHealRef.current[healKey] = true

    syncPostClosePrices({ silent: true, force: true }).catch((err) => {
      console.warn('收盤價自我修復同步失敗:', err)
    })
  }, [
    activePortfolioId,
    ready,
    shouldTriggerPostCloseSelfHeal,
    todayMarketClock.isWeekend,
    todayMarketClock.marketDate,
    todayMarketClock.minutes,
    viewMode,
    portfolioViewMode,
    priceSelfHealRef,
    syncPostClosePrices,
  ])
}
