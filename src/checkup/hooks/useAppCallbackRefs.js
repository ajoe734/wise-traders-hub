import { useEffect } from 'react'

export function useAppCallbackRefs({
  refreshAnalystReportsRef = null,
  refreshAnalystReports = null,
  resetTradeCaptureRef = null,
  resetTradeCapture = null,
}) {
  useEffect(() => {
    const callbackRefs = [
      [refreshAnalystReportsRef, refreshAnalystReports],
      [resetTradeCaptureRef, resetTradeCapture],
    ]
    callbackRefs.forEach(([ref, value]) => {
      if (ref) {
        ref.current = value
      }
    })
  }, [
    refreshAnalystReports,
    refreshAnalystReportsRef,
    resetTradeCapture,
    resetTradeCaptureRef,
  ])
}
