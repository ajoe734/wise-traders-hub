import { useMemo } from 'react'
import { useTradeCaptureRuntime } from './useTradeCaptureRuntime.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'
import { useCheckupMode } from '../contexts/CheckupModeContext.jsx'

export function useRouteTradePage() {
  const {
    holdings = [],
    tradeLog = [],
    setHoldings = () => {},
    setTradeLog = () => {},
    upsertTargetReport = () => false,
    upsertFundamentalsEntry = () => false,
    applyTradeEntryToHoldings = (rows) => rows,
    createDefaultFundamentalDraft = () => ({}),
    toSlashDate = () => new Date().toISOString().slice(0, 10),
    flashSaved = () => {},
  } = usePortfolioRouteContext()

  const { isDemo } = useCheckupMode()

  const tradeRuntime = useTradeCaptureRuntime({
    holdings,
    tradeLog,
    setHoldings,
    setTradeLog,
    upsertTargetReport,
    upsertFundamentalsEntry,
    applyTradeEntryToHoldings,
    createDefaultFundamentalDraft,
    toSlashDate,
    flashSaved,
    isDemo,
  })

  return useMemo(() => tradeRuntime, [tradeRuntime])
}
