import { useEffect } from 'react'

export function useAppRuntimeSyncRefs({
  activePortfolioIdRef,
  activePortfolioId,
  viewModeRef,
  viewMode,
  portfoliosRef,
  portfolios,
  portfolioSetterRef,
  setActivePortfolioId,
  setViewMode,
  bootRuntimeRef,
  marketPriceCache,
  applyPortfolioSnapshot,
  setPortfolios,
  portfolioTransitionRef,
}) {
  useEffect(() => {
    activePortfolioIdRef.current = activePortfolioId
    viewModeRef.current = viewMode
    portfoliosRef.current = portfolios
    portfolioSetterRef.current = {
      setActivePortfolioId,
      setViewMode,
    }
    bootRuntimeRef.current = {
      activePortfolioId,
      marketPriceQuotes: marketPriceCache?.prices || null,
      applyPortfolioSnapshot,
      setPortfolios,
      setActivePortfolioId,
      setViewMode,
      portfolioTransitionRef,
    }
  }, [
    activePortfolioId,
    activePortfolioIdRef,
    applyPortfolioSnapshot,
    bootRuntimeRef,
    marketPriceCache,
    portfolioSetterRef,
    portfolioTransitionRef,
    portfolios,
    portfoliosRef,
    setActivePortfolioId,
    setPortfolios,
    setViewMode,
    viewMode,
    viewModeRef,
  ])
}
