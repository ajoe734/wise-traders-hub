import { useCallback, useState } from 'react'
import { APP_LABELS } from '../lib/appMessages.js'
import { createDefaultReviewForm } from '../lib/eventUtils.js'

export function useAppShellUiState({ resetTradeCaptureRef = null } = {}) {
  const [tab, setTab] = useState('holdings')
  const [sortBy, setSortBy] = useState('value')
  const [scanQuery, setScanQuery] = useState('')
  const [scanFilter, setScanFilter] = useState(APP_LABELS.allFilter)
  const [filterType, setFilterType] = useState(APP_LABELS.allFilter)
  const [catalystFilter, setCatalystFilter] = useState('全部')
  const [showReversal, setShowReversal] = useState(false)
  const [dailyExpanded, setDailyExpanded] = useState(false)
  const [expandedStock, setExpandedStock] = useState(null)
  const [expandedNews, setExpandedNews] = useState(new Set())
  const [reviewingEvent, setReviewingEvent] = useState(null)
  const [reviewForm, setReviewForm] = useState(() => createDefaultReviewForm())
  const [relayPlanExpanded, setRelayPlanExpanded] = useState(false)
  const [researchTarget, setResearchTarget] = useState(null)
  const [researchResults, setResearchResults] = useState(null)

  const resetTransientUiState = useCallback(() => {
    resetTradeCaptureRef?.current?.()
    setDailyExpanded(false)
    setExpandedStock(null)
    setExpandedNews(new Set())
    setReviewingEvent(null)
    setReviewForm(createDefaultReviewForm())
    setResearchTarget(null)
    setResearchResults(null)
    setRelayPlanExpanded(false)
    setCatalystFilter('全部')
  }, [resetTradeCaptureRef])

  return {
    tab,
    setTab,
    sortBy,
    setSortBy,
    scanQuery,
    setScanQuery,
    scanFilter,
    setScanFilter,
    filterType,
    setFilterType,
    catalystFilter,
    setCatalystFilter,
    showReversal,
    setShowReversal,
    dailyExpanded,
    setDailyExpanded,
    expandedStock,
    setExpandedStock,
    expandedNews,
    setExpandedNews,
    reviewingEvent,
    setReviewingEvent,
    reviewForm,
    setReviewForm,
    relayPlanExpanded,
    setRelayPlanExpanded,
    researchTarget,
    setResearchTarget,
    researchResults,
    setResearchResults,
    resetTransientUiState,
  }
}
