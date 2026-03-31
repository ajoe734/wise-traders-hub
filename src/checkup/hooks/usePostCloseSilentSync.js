import { useEffect } from 'react'

export function usePostCloseSilentSync({
  ready,
  viewMode,
  portfolioViewMode,
  activePortfolioId,
  syncPostClosePrices,
}) {
  useEffect(() => {
    if (!ready || viewMode !== portfolioViewMode) return

    syncPostClosePrices({ silent: true }).catch((err) => {
      console.warn('收盤價靜默同步失敗:', err)
    })
  }, [ready, viewMode, portfolioViewMode, activePortfolioId, syncPostClosePrices])
}
