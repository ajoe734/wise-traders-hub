import { useMemo } from 'react'

export function usePortfolioDerivedData({
  holdings,
  watchlist,
  sortBy,
  holdingDossiers,
  targets,
  fundamentals,
  analystReports,
  newsEvents,
  researchHistory,
  strategyBrain,
  marketPriceCache,
  marketPriceSync,
  activePortfolioId,
  portfolioSummaries,
  viewMode,
  portfolioNotes,
  reportRefreshMeta,
  helpers,
  constants,
}) {
  const {
    normalizeHoldingDossiers,
    buildHoldingDossiers,
    getHoldingMarketValue,
    getHoldingCostBasis,
    getHoldingUnrealizedPnl,
    getHoldingReturnPct,
    applyMarketQuotesToHoldings,
    clonePortfolioNotes,
    normalizeNewsEvents,
    getEventStockCodes,
    isClosedEvent,
    parseFlexibleDate,
    todayStorageDate,
    formatDateToStorageDate,
    getTaipeiClock,
    parseStoredDate,
    readStorageValue,
    pfKey,
    getPortfolioFallback,
  } = helpers
  const {
    OWNER_PORTFOLIO_ID,
    PORTFOLIO_VIEW_MODE,
    OVERVIEW_VIEW_MODE,
    POST_CLOSE_SYNC_MINUTES,
    RELAY_PLAN_CODES,
    STOCK_META,
    C,
  } = constants

  const H = useMemo(() => (Array.isArray(holdings) ? holdings : []), [holdings])
  const currentNewsEvents = useMemo(
    () => (Array.isArray(newsEvents) ? newsEvents : []),
    [newsEvents]
  )

  const W = useMemo(() => {
    const watchlistRows = Array.isArray(watchlist) ? watchlist : []
    if (!marketPriceCache?.prices || watchlistRows.length === 0) return watchlistRows

    return watchlistRows.map((item) => {
      const quote = marketPriceCache.prices[item.code]
      if (!quote?.price) return item

      const newPrice = quote.price
      const newTarget = item.target || null
      const newUpside = newTarget && newPrice > 0 ? ((newTarget - newPrice) / newPrice) * 100 : null

      return {
        ...item,
        price: newPrice,
        change: quote.change || 0,
        changePct: quote.changePct || 0,
        upside: newUpside,
      }
    })
  }, [watchlist, marketPriceCache])

  const D = useMemo(() => {
    const normalized = normalizeHoldingDossiers(holdingDossiers)
    if (normalized.length > 0) return normalized
    return buildHoldingDossiers({
      holdings: H,
      watchlist: W,
      targets,
      fundamentals,
      analystReports,
      newsEvents: currentNewsEvents,
      researchHistory,
      strategyBrain,
      marketPriceCache,
      marketPriceSync,
    })
  }, [
    holdingDossiers,
    H,
    W,
    targets,
    fundamentals,
    analystReports,
    currentNewsEvents,
    researchHistory,
    strategyBrain,
    marketPriceCache,
    marketPriceSync,
    normalizeHoldingDossiers,
    buildHoldingDossiers,
  ])

  const dossierByCode = useMemo(() => new Map(D.map((item) => [item.code, item])), [D])
  const totalVal = useMemo(
    () => H.reduce((sum, item) => sum + getHoldingMarketValue(item), 0),
    [H, getHoldingMarketValue]
  )
  const totalCost = useMemo(
    () => H.reduce((sum, item) => sum + getHoldingCostBasis(item), 0),
    [H, getHoldingCostBasis]
  )
  const totalPnl = totalVal - totalCost
  const retPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const todayMarketClock = getTaipeiClock(new Date())
  const activeMarketDate = marketPriceSync?.marketDate || marketPriceCache?.marketDate || null
  const activePriceSyncAt = parseStoredDate(
    marketPriceSync?.syncedAt || marketPriceCache?.syncedAt || null
  )
  const priceSyncStatusLabel = !activeMarketDate
    ? '收盤價未同步'
    : activeMarketDate === todayMarketClock.marketDate
      ? `收盤價 ${activeMarketDate.replace(/-/g, '/')}`
      : `沿用 ${activeMarketDate.replace(/-/g, '/')}`
  const priceSyncStatusTone = !activeMarketDate
    ? C.amber
    : activeMarketDate === todayMarketClock.marketDate
      ? C.olive
      : C.textMute
  const holdingsIntegrityIssues = useMemo(
    () => H.filter((item) => item?.integrityIssue === 'missing-price'),
    [H]
  )
  const missingTrackedQuoteCodes = useMemo(
    () => H.map((item) => String(item?.code || '').trim()),
    [H]
  )

  const shouldTriggerPostCloseSelfHeal =
    !todayMarketClock.isWeekend &&
    todayMarketClock.minutes >= POST_CLOSE_SYNC_MINUTES &&
    H.length > 0 &&
    (totalVal <= 0 ||
      holdingsIntegrityIssues.length > 0 ||
      activeMarketDate !== todayMarketClock.marketDate ||
      missingTrackedQuoteCodes.length > 0)

  const overviewPortfolios = useMemo(() => {
    const getPortfolioSnapshot = (portfolioId) => {
      const useLiveState = viewMode === PORTFOLIO_VIEW_MODE && portfolioId === activePortfolioId
      const holdingsValue = useLiveState ? H : readStorageValue(pfKey(portfolioId, 'holdings-v2'))
      const eventsValue = useLiveState
        ? currentNewsEvents
        : readStorageValue(pfKey(portfolioId, 'news-events-v1'))
      const notesValue = useLiveState
        ? portfolioNotes
        : readStorageValue(pfKey(portfolioId, 'notes-v1'))
      return {
        holdings: applyMarketQuotesToHoldings(
          Array.isArray(holdingsValue)
            ? holdingsValue
            : getPortfolioFallback(portfolioId, 'holdings-v2'),
          marketPriceCache?.prices
        ),
        newsEvents: normalizeNewsEvents(
          Array.isArray(eventsValue)
            ? eventsValue
            : getPortfolioFallback(portfolioId, 'news-events-v1')
        ),
        notes:
          notesValue && typeof notesValue === 'object'
            ? { ...clonePortfolioNotes(), ...notesValue }
            : clonePortfolioNotes(),
      }
    }

    return (portfolioSummaries || []).map((portfolio) => {
      const snapshot = getPortfolioSnapshot(portfolio.id)
      const pendingEvents = (snapshot.newsEvents || []).filter((event) => !isClosedEvent(event))
      return {
        ...portfolio,
        holdings: snapshot.holdings,
        newsEvents: snapshot.newsEvents,
        notes: snapshot.notes,
        pendingEvents,
      }
    })
  }, [
    portfolioSummaries,
    viewMode,
    PORTFOLIO_VIEW_MODE,
    activePortfolioId,
    H,
    currentNewsEvents,
    portfolioNotes,
    marketPriceCache,
    applyMarketQuotesToHoldings,
    normalizeNewsEvents,
    clonePortfolioNotes,
    isClosedEvent,
    readStorageValue,
    pfKey,
    getPortfolioFallback,
  ])

  const overviewTotalValue = useMemo(
    () => overviewPortfolios.reduce((sum, portfolio) => sum + portfolio.totalValue, 0),
    [overviewPortfolios]
  )
  const overviewTotalPnl = useMemo(
    () => overviewPortfolios.reduce((sum, portfolio) => sum + portfolio.totalPnl, 0),
    [overviewPortfolios]
  )
  const overviewTotalCost = useMemo(
    () =>
      overviewPortfolios.reduce(
        (sum, portfolio) => sum + (portfolio.totalValue - portfolio.totalPnl),
        0
      ),
    [overviewPortfolios]
  )
  const overviewRetPct = overviewTotalCost > 0 ? (overviewTotalPnl / overviewTotalCost) * 100 : 0
  const displayedTotalPnl = viewMode === OVERVIEW_VIEW_MODE ? overviewTotalPnl : totalPnl
  const displayedRetPct = viewMode === OVERVIEW_VIEW_MODE ? overviewRetPct : retPct

  const overviewDuplicateHoldings = useMemo(() => {
    const byCode = new Map()
    overviewPortfolios.forEach((portfolio) => {
      ;(portfolio.holdings || []).forEach((item) => {
        const existing = byCode.get(item.code) || {
          code: item.code,
          name: item.name,
          totalValue: 0,
          portfolios: [],
        }
        const holdingValue = getHoldingMarketValue(item)
        const holdingPnl = getHoldingUnrealizedPnl(item)
        existing.totalValue += holdingValue
        existing.portfolios.push({
          id: portfolio.id,
          name: portfolio.name,
          qty: Number(item.qty) || 0,
          value: holdingValue,
          pnl: holdingPnl,
        })
        byCode.set(item.code, existing)
      })
    })
    return Array.from(byCode.values())
      .filter((item) => item.portfolios.length > 1)
      .sort((a, b) => b.portfolios.length - a.portfolios.length || b.totalValue - a.totalValue)
  }, [overviewPortfolios, getHoldingMarketValue, getHoldingUnrealizedPnl])

  const overviewPendingItems = useMemo(
    () =>
      overviewPortfolios
        .flatMap((portfolio) =>
          portfolio.pendingEvents.map((event) => ({
            ...event,
            portfolioId: portfolio.id,
            portfolioName: portfolio.name,
          }))
        )
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))),
    [overviewPortfolios]
  )

  const todayAlertItems = useMemo(
    () =>
      H.filter((item) => typeof item.alert === 'string' && item.alert.trim())
        .map((item) => {
          const alertText = item.alert.replace(/^⚡\s*/, '').trim()
          if (!alertText) return null
          if (alertText.includes('法說')) return `${item.name}${alertText}`
          if (alertText.includes('出場區間'))
            return `${item.name}已到${alertText.replace(/到$/, '')}`
          return `${item.name} ${alertText}`
        })
        .filter(Boolean),
    [H]
  )

  const urgentCount = todayAlertItems.length
  const todayAlertSummary =
    urgentCount > 2
      ? `${todayAlertItems.slice(0, 2).join(' · ')} · 另有 ${urgentCount - 2} 項提醒`
      : todayAlertItems.join(' · ')

  const watchlistRows = useMemo(
    () =>
      W.map((item, index) => {
        const relatedEvents = currentNewsEvents.filter((event) =>
          event.stocks?.some((stock) => stock.includes(item.code))
        )
        const trackingCount = relatedEvents.filter((event) => event.status === 'tracking').length
        const pendingCount = relatedEvents.filter((event) => event.status === 'pending').length
        const hits = relatedEvents.filter((event) => event.correct === true).length
        const misses = relatedEvents.filter((event) => event.correct === false).length
        const isUrgent =
          /⚡/.test(item.status || '') ||
          relatedEvents.some((event) => {
            if (!event) return false
            const eventDate = parseFlexibleDate(
              event.eventDate || event.date || event.trackingStart || event.exitDate
            )
            if (!eventDate) return false
            return formatDateToStorageDate(eventDate) === todayStorageDate()
          })
        const primaryEvent =
          relatedEvents.find((event) => event.status === 'tracking') ||
          relatedEvents.find((event) => event.status === 'pending') ||
          relatedEvents[0] ||
          null
        const upside =
          item.price > 0 && item.target > 0 ? ((item.target - item.price) / item.price) * 100 : null
        const summary = primaryEvent?.title || item.catalyst || item.note || '持續觀察'
        const action = isUrgent
          ? '今天先看事件結果，再決定是否加碼、續抱或停損。'
          : trackingCount > 0
            ? '目前已進入追蹤期，優先看價格與事件驗證。'
            : pendingCount > 0
              ? '先保留觀察，等事件落地再加大部位。'
              : item.note || '暫列觀察名單，還不急著動作。'
        const priority =
          (isUrgent ? 5 : 0) +
          (trackingCount > 0 ? 3 : 0) +
          (pendingCount > 0 ? 2 : 0) +
          (upside != null && upside >= 20 ? 1 : 0)
        return {
          item,
          index,
          relatedEvents,
          trackingCount,
          pendingCount,
          hits,
          misses,
          primaryEvent,
          upside,
          summary,
          action,
          priority,
        }
      }),
    [W, currentNewsEvents, parseFlexibleDate, formatDateToStorageDate, todayStorageDate]
  )

  const watchlistFocus = useMemo(
    () =>
      watchlistRows.length > 0
        ? [...watchlistRows].sort(
            (a, b) => b.priority - a.priority || (b.upside ?? -999) - (a.upside ?? -999)
          )[0]
        : null,
    [watchlistRows]
  )

  const showRelayPlan =
    activePortfolioId === OWNER_PORTFOLIO_ID ||
    H.some((item) => RELAY_PLAN_CODES.has(item.code)) ||
    W.some((item) => RELAY_PLAN_CODES.has(item.code))

  const sorted = useMemo(
    () =>
      [...H].sort((a, b) => {
        if (sortBy === 'value') return getHoldingMarketValue(b) - getHoldingMarketValue(a)
        if (sortBy === 'pnl')
          return (getHoldingUnrealizedPnl(b) || 0) - (getHoldingUnrealizedPnl(a) || 0)
        if (sortBy === 'pct') {
          const pctA = getHoldingReturnPct(a) || 0
          const pctB = getHoldingReturnPct(b) || 0
          return pctB - pctA
        }
        return 0
      }),
    [H, sortBy, getHoldingMarketValue, getHoldingUnrealizedPnl, getHoldingReturnPct]
  )

  const scanRows = useMemo(
    () =>
      sorted.map((item) => {
        const meta = STOCK_META[item.code]
        const targetEntry = targets?.[item.code]
        const relatedEvents = currentNewsEvents.filter((event) =>
          event.stocks?.some((stock) => stock.includes(item.code))
        )
        const hasPending = relatedEvents.some((event) => event.correct == null)
        const pnl = getHoldingUnrealizedPnl(item)
        const priority =
          item.alert || targetEntry?.isNew
            ? 'A'
            : hasPending || (pnl !== null && pnl < 0)
              ? 'B'
              : 'C'
        const needsAttention = priority !== 'C'
        return {
          h: item,
          meta,
          T: targetEntry,
          relatedEvents,
          hasPending,
          needsAttention,
          priority,
        }
      }),
    [sorted, targets, currentNewsEvents, STOCK_META, getHoldingUnrealizedPnl]
  )

  const top5 = useMemo(
    () => [...H].sort((a, b) => getHoldingMarketValue(b) - getHoldingMarketValue(a)).slice(0, 5),
    [H, getHoldingMarketValue]
  )
  const winners = useMemo(
    () =>
      H.filter((item) => getHoldingUnrealizedPnl(item) > 0).sort(
        (a, b) => getHoldingReturnPct(b) - getHoldingReturnPct(a)
      ),
    [H, getHoldingUnrealizedPnl, getHoldingReturnPct]
  )
  const losers = useMemo(
    () =>
      H.filter((item) => getHoldingUnrealizedPnl(item) < 0).sort(
        (a, b) => getHoldingReturnPct(a) - getHoldingReturnPct(b)
      ),
    [H, getHoldingUnrealizedPnl, getHoldingReturnPct]
  )
  const attentionCount = scanRows.filter((item) => item.needsAttention).length
  const pendingCount = scanRows.filter((item) => item.hasPending).length
  const targetUpdateCount = scanRows.filter((item) => item.T?.isNew).length

  const dataRefreshRows = useMemo(
    () =>
      D.map((dossier) => {
        const targetStatus = dossier?.freshness?.targets || 'missing'
        const fundamentalStatus = dossier?.freshness?.fundamentals || 'missing'
        const severity =
          (targetStatus === 'missing' ? 2 : targetStatus === 'stale' ? 1 : 0) +
          (fundamentalStatus === 'missing' ? 2 : fundamentalStatus === 'stale' ? 1 : 0)
        return {
          code: dossier.code,
          name: dossier.name,
          targetStatus,
          fundamentalStatus,
          severity,
          targetUpdatedAt: dossier.targets?.updatedAt || null,
          fundamentalsUpdatedAt: dossier.fundamentals?.updatedAt || null,
        }
      })
        .filter((item) => item.severity > 0)
        .sort((a, b) => b.severity - a.severity || String(a.code).localeCompare(String(b.code))),
    [D]
  )

  const todayRefreshKey = getTaipeiClock(new Date()).marketDate
  const reportRefreshCandidates = useMemo(
    () =>
      H.map((holding) => {
        const dossier = dossierByCode.get(holding.code) || null
        const refreshEntry = reportRefreshMeta?.[holding.code] || {}
        const relatedEvents = currentNewsEvents.filter(
          (event) => getEventStockCodes(event).includes(holding.code) && !isClosedEvent(event)
        )
        const targetStatus = dossier?.freshness?.targets || 'missing'
        const analystStatus = dossier?.freshness?.analyst || 'missing'
        const score =
          (targetStatus === 'missing' ? 5 : targetStatus === 'stale' ? 3 : 0) +
          (analystStatus === 'missing' ? 4 : analystStatus === 'stale' ? 2 : 0) +
          (relatedEvents.length > 0 ? 2 : 0)
        return {
          holding,
          score,
          targetStatus,
          analystStatus,
          relatedEvents,
          checkedToday: refreshEntry.checkedDate === todayRefreshKey,
        }
      })
        .filter((item) => item.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score || getHoldingMarketValue(b.holding) - getHoldingMarketValue(a.holding)
        ),
    [
      H,
      dossierByCode,
      reportRefreshMeta,
      currentNewsEvents,
      todayRefreshKey,
      getEventStockCodes,
      isClosedEvent,
      getHoldingMarketValue,
    ]
  )

  return {
    H,
    W,
    D,
    dossierByCode,
    currentNewsEvents,
    totalVal,
    totalCost,
    totalPnl,
    retPct,
    todayMarketClock,
    activeMarketDate,
    activePriceSyncAt,
    priceSyncStatusLabel,
    priceSyncStatusTone,
    holdingsIntegrityIssues,
    missingTrackedQuoteCodes,
    shouldTriggerPostCloseSelfHeal,
    overviewPortfolios,
    overviewTotalValue,
    overviewTotalPnl,
    overviewRetPct,
    displayedTotalPnl,
    displayedRetPct,
    overviewDuplicateHoldings,
    overviewPendingItems,
    urgentCount,
    todayAlertSummary,
    watchlistRows,
    watchlistFocus,
    showRelayPlan,
    scanRows,
    top5,
    winners,
    losers,
    attentionCount,
    pendingCount,
    targetUpdateCount,
    dataRefreshRows,
    todayRefreshKey,
    reportRefreshCandidates,
  }
}
