import { useCallback, useMemo, useRef, useState } from 'react'
import {
  API_ENDPOINTS,
  MARKET_PRICE_CACHE_KEY,
  MARKET_PRICE_SYNC_KEY,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  PORTFOLIO_VIEW_MODE,
  POST_CLOSE_SYNC_MINUTES,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import { APP_DIALOG_MESSAGES, APP_TOAST_MESSAGES } from '../lib/appMessages.js'
import { getTaipeiClock, parseStoredDate } from '../lib/datetime.js'
import { getEventStockCodes } from '../lib/eventUtils.js'
import { applyMarketQuotesToHoldings, resolveHoldingPrice } from '../lib/holdings.js'
import {
  canRunPostClosePriceSync,
  createEmptyMarketPriceCache,
  extractBestPrice,
  extractYesterday,
  getCachedQuotesForCodes,
  normalizeMarketPriceCache,
  normalizeMarketPriceSync,
} from '../lib/market.js'
import {
  buildTwseBatchQueries,
  collectTrackedCodes as collectTrackedCodesFromPortfolios,
  extractQuotesFromTwsePayload,
} from '../lib/marketSyncRuntime.js'
import { pfKey, readStorageValue, save } from '../lib/portfolioUtils.js'

export function useMarketData({
  holdings = [],
  watchlist = [],
  newsEvents = [],
  portfoliosRef = { current: [] },
  activePortfolioIdRef = { current: '' },
  viewModeRef = { current: PORTFOLIO_VIEW_MODE },
  setHoldings = () => {},
  notifySaved = () => {},
  requestConfirmation = async () => true,
} = {}) {
  const [marketPriceCache, setMarketPriceCache] = useState(() =>
    normalizeMarketPriceCache(readStorageValue(MARKET_PRICE_CACHE_KEY))
  )
  const [marketPriceSync, setMarketPriceSync] = useState(() =>
    normalizeMarketPriceSync(readStorageValue(MARKET_PRICE_SYNC_KEY))
  )
  const [lastUpdate, setLastUpdate] = useState(() => {
    const cachedSync = normalizeMarketPriceSync(readStorageValue(MARKET_PRICE_SYNC_KEY))
    const cachedPrice = normalizeMarketPriceCache(readStorageValue(MARKET_PRICE_CACHE_KEY))
    return parseStoredDate(cachedSync?.syncedAt || cachedPrice?.syncedAt)
  })
  const [refreshing, setRefreshing] = useState(false)

  const priceSyncInFlightRef = useRef(null)
  const priceSelfHealRef = useRef({})

  const persistMarketPriceState = useCallback(async (cache, syncMeta) => {
    const normalizedCache = normalizeMarketPriceCache(cache)
    const normalizedSync = normalizeMarketPriceSync(syncMeta)
    await save(MARKET_PRICE_CACHE_KEY, normalizedCache)
    await save(MARKET_PRICE_SYNC_KEY, normalizedSync)
    setMarketPriceCache(normalizedCache)
    setMarketPriceSync(normalizedSync)
    const syncedAt = parseStoredDate(normalizedSync?.syncedAt || normalizedCache?.syncedAt)
    if (syncedAt) setLastUpdate(syncedAt)
  }, [])

  const collectTrackedCodes = useCallback(
    () =>
      collectTrackedCodesFromPortfolios({
        portfolios: portfoliosRef.current,
        currentActivePortfolioId: activePortfolioIdRef.current,
        currentViewMode: viewModeRef.current,
        liveState: {
          holdings,
          watchlist,
          newsEvents,
        },
        readStorageValue,
        pfKey,
        portfolioAliasToSuffix: PORTFOLIO_ALIAS_TO_SUFFIX,
        getEventStockCodes,
        portfolioViewMode: PORTFOLIO_VIEW_MODE,
      }),
    [holdings, newsEvents, watchlist, portfoliosRef, activePortfolioIdRef, viewModeRef]
  )

  const fetchPostCloseQuotes = useCallback(async (codes, timeoutMs = 8000) => {
    const normalizedCodes = buildTwseBatchQueries(codes).flat()
    if (normalizedCodes.length === 0) return { quotes: {}, failedCodes: [], marketDate: null }

    const quotes = {}
    const failedCodes = new Set()
    const observedMarketDates = new Set()
    const batches = buildTwseBatchQueries(normalizedCodes)

    await Promise.all(
      batches.map(async (batch, batchIndex) => {
        const queries = batch.flatMap((code) => [`tse_${code}.tw`, `otc_${code}.tw`])
        const exCh = queries.join('|')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
          const response = await fetch(`${API_ENDPOINTS.TWSE}?ex_ch=${encodeURIComponent(exCh)}`, {
            signal: controller.signal,
          })
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data?.detail || data?.error || `TWSE 請求失敗 (${response.status})`)
          }
          const extracted = extractQuotesFromTwsePayload(data, {
            extractBestPrice,
            extractYesterday,
          })
          Object.assign(quotes, extracted.quotes)
          if (extracted.marketDate) observedMarketDates.add(extracted.marketDate)
        } catch (error) {
          batch.forEach((code) => failedCodes.add(code))
          console.warn(`收盤價同步批次 ${batchIndex + 1} 失敗:`, error)
        } finally {
          clearTimeout(timer)
        }
      })
    )

    return {
      quotes,
      failedCodes: Array.from(failedCodes).filter((code) => !quotes[code]),
      marketDate: Array.from(observedMarketDates).sort().slice(-1)[0] || null,
    }
  }, [])

  const syncPostClosePrices = useCallback(
    async ({ silent = false, force = false } = {}) => {
      if (priceSyncInFlightRef.current) return priceSyncInFlightRef.current

      const task = (async () => {
        const currentViewMode = viewModeRef.current
        const cachedSync =
          normalizeMarketPriceSync(readStorageValue(MARKET_PRICE_SYNC_KEY)) || marketPriceSync
        const cachedPrice =
          normalizeMarketPriceCache(readStorageValue(MARKET_PRICE_CACHE_KEY)) || marketPriceCache
        const gate = canRunPostClosePriceSync(new Date(), cachedSync)
        const trackedCodes = collectTrackedCodes()
        const allowForcedRetry = force && trackedCodes.length > 0

        if (!gate.allowed && !allowForcedRetry) {
          if (!silent) {
            if (gate.reason === 'before-close') {
              notifySaved(APP_TOAST_MESSAGES.priceSyncBeforeClose)
            } else if (gate.reason === 'market-closed') {
              notifySaved(APP_TOAST_MESSAGES.priceSyncMarketClosed)
            } else if (cachedSync?.status === 'failed') {
              notifySaved(APP_TOAST_MESSAGES.priceSyncAlreadyAttempted)
            } else {
              notifySaved(APP_TOAST_MESSAGES.priceSyncAlreadyDone)
            }
          }
          if (cachedPrice?.prices && currentViewMode === PORTFOLIO_VIEW_MODE) {
            setHoldings((prev) => applyMarketQuotesToHoldings(prev, cachedPrice.prices))
          }
          return cachedPrice
        }

        if (trackedCodes.length === 0) {
          if (!silent) notifySaved(APP_TOAST_MESSAGES.priceSyncNoTrackedCodes)
          return cachedPrice
        }

        const syncedAt = new Date().toISOString()
        const {
          quotes,
          failedCodes,
          marketDate: observedMarketDate,
        } = await fetchPostCloseQuotes(trackedCodes)
        const resolvedMarketDate = observedMarketDate || gate.clock.marketDate

        if (Object.keys(quotes).length === 0) {
          const failedMeta = {
            marketDate: resolvedMarketDate,
            syncedAt,
            status: 'failed',
            codes: trackedCodes,
            failedCodes,
          }
          await persistMarketPriceState(cachedPrice || createEmptyMarketPriceCache(), failedMeta)
          if (!silent) notifySaved(APP_TOAST_MESSAGES.priceSyncFailedKeepCache)
          return cachedPrice
        }

        const nextCache = {
          ...(cachedPrice || createEmptyMarketPriceCache()),
          marketDate: resolvedMarketDate,
          syncedAt,
          source: 'twse',
          status: failedCodes.length > 0 ? 'partial' : 'fresh',
          prices: {
            ...((cachedPrice && cachedPrice.prices) || {}),
            ...quotes,
          },
        }
        const nextSync = {
          marketDate: resolvedMarketDate,
          syncedAt,
          status: failedCodes.length > 0 ? 'partial' : 'success',
          codes: trackedCodes,
          failedCodes,
        }

        await persistMarketPriceState(nextCache, nextSync)
        if (currentViewMode === PORTFOLIO_VIEW_MODE) {
          setHoldings((prev) => applyMarketQuotesToHoldings(prev, nextCache.prices))
        }

        if (!silent) {
          if (failedCodes.length > 0) {
            notifySaved(
              APP_TOAST_MESSAGES.priceSyncSyncedPartial(
                trackedCodes.length - failedCodes.length,
                trackedCodes.length
              ),
              STATUS_MESSAGE_TIMEOUT_MS.LONG
            )
          } else {
            notifySaved(
              APP_TOAST_MESSAGES.priceSyncSyncedAll(trackedCodes.length),
              STATUS_MESSAGE_TIMEOUT_MS.LONG
            )
          }
        }

        return nextCache
      })().finally(() => {
        priceSyncInFlightRef.current = null
      })

      priceSyncInFlightRef.current = task
      return task
    },
    [
      collectTrackedCodes,
      fetchPostCloseQuotes,
      marketPriceCache,
      marketPriceSync,
      notifySaved,
      persistMarketPriceState,
      setHoldings,
      viewModeRef,
    ]
  )

  const getMarketQuotesForCodes = useCallback(
    async (codes, { ensureSynced = true } = {}) => {
      const normalizedCodes = Array.from(
        new Set((codes || []).map((code) => String(code || '').trim()).filter(Boolean))
      )
      if (normalizedCodes.length === 0) return {}
      const cache = ensureSynced
        ? await syncPostClosePrices({ silent: true })
        : marketPriceCache || normalizeMarketPriceCache(readStorageValue(MARKET_PRICE_CACHE_KEY))
      return getCachedQuotesForCodes(cache, normalizedCodes)
    },
    [marketPriceCache, syncPostClosePrices]
  )

  const refreshPrices = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)

    try {
      const clock = getTaipeiClock(new Date())
      const hasMissingTrackedQuotes =
        Array.isArray(holdings) &&
        holdings.some((item) => {
          const code = String(item?.code || '').trim()
          return code && !(marketPriceCache?.prices?.[code]?.price > 0)
        })
      const isTradingDay = !clock.isWeekend && clock.minutes >= POST_CLOSE_SYNC_MINUTES
      const alreadySyncedToday = marketPriceSync?.marketDate === clock.marketDate

      if (isTradingDay && alreadySyncedToday && !hasMissingTrackedQuotes) {
        const confirmed = await requestConfirmation(
          APP_DIALOG_MESSAGES.priceSyncAlreadySynced(
            marketPriceSync?.syncedAt?.slice(11, 16) || 'N/A'
          )
        )
        if (!confirmed) {
          notifySaved(APP_TOAST_MESSAGES.priceSyncUseCache, STATUS_MESSAGE_TIMEOUT_MS.BRIEF)
          return
        }
      }

      const shouldForceRepair =
        Array.isArray(holdings) &&
        (holdings.some(
          (item) => item?.integrityIssue === 'missing-price' || resolveHoldingPrice(item) <= 0
        ) ||
          (isTradingDay &&
            (marketPriceSync?.marketDate !== clock.marketDate || hasMissingTrackedQuotes)))
      const shouldForceManualRefresh = !isTradingDay || alreadySyncedToday
      const cache = await syncPostClosePrices({
        silent: false,
        force: shouldForceRepair || shouldForceManualRefresh,
      })

      if (
        cache?.prices &&
        Object.keys(cache.prices).length > 0 &&
        viewModeRef.current === PORTFOLIO_VIEW_MODE
      ) {
        setHoldings((prev) => applyMarketQuotesToHoldings(prev, cache.prices))
      }
    } catch (error) {
      console.error('收盤價同步失敗:', error)
      notifySaved(APP_TOAST_MESSAGES.priceSyncFailedRetry)
    } finally {
      setRefreshing(false)
    }
  }, [
    holdings,
    marketPriceCache,
    marketPriceSync,
    notifySaved,
    refreshing,
    requestConfirmation,
    setHoldings,
    syncPostClosePrices,
    viewModeRef,
  ])

  const priceSyncStatusLabel = useMemo(() => {
    if (!marketPriceSync) return '未同步'
    if (marketPriceSync.status === 'failed') return '同步失敗'
    if (marketPriceSync.status === 'partial') return '部分成功'
    if (marketPriceSync.status === 'success') return '已同步'
    return '未同步'
  }, [marketPriceSync])

  const priceSyncStatusTone = useMemo(() => {
    if (!marketPriceSync) return '#888'
    if (marketPriceSync.status === 'failed') return '#ef4444'
    if (marketPriceSync.status === 'partial') return '#f59e0b'
    if (marketPriceSync.status === 'success') return '#22c55e'
    return '#888'
  }, [marketPriceSync])

  const activePriceSyncAt = useMemo(() => {
    if (!marketPriceSync?.syncedAt) return null
    return parseStoredDate(marketPriceSync.syncedAt)
  }, [marketPriceSync])

  return {
    marketPriceCache,
    marketPriceSync,
    lastUpdate,
    setLastUpdate,
    refreshing,
    priceSyncStatusLabel,
    priceSyncStatusTone,
    activePriceSyncAt,
    refreshPrices,
    syncPostClosePrices,
    getMarketQuotesForCodes,
    priceSelfHealRef,
  }
}
