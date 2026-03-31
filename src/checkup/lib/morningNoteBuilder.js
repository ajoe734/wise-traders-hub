/**
 * Morning Note Builder — 每日交易備忘組裝器
 * 從現有資料源組裝結構化的每日備忘
 */

/**
 * Filter and format today's events with thesis pillar links
 */
export function buildTodayEvents(events, theses, today) {
  if (!Array.isArray(events)) return []

  return events
    .filter((e) => e.date === today)
    .map((e) => {
      const stockCodes = (e.stocks || [])
        .map((s) => {
          const match = String(s).match(/\d{4,6}/)
          return match ? match[0] : null
        })
        .filter(Boolean)

      const relatedPillars = (theses || [])
        .filter((t) => stockCodes.includes(t.stockId))
        .flatMap((t) => (t.pillars || []).map((p) => ({ stockId: t.stockId, pillar: p })))

      const impactLabel = (e.impact || '').toUpperCase() || null

      return {
        title: e.title,
        date: e.date,
        catalystType: e.catalystType || null,
        impactLabel,
        stocks: stockCodes,
        relatedPillars,
      }
    })
}

/**
 * Format holding status with thesis scorecard summary
 */
export function buildHoldingStatus(holdings, theses) {
  if (!Array.isArray(holdings)) return []

  return holdings.map((h) => {
    const thesis = (theses || []).find((t) => t.stockId === h.code)
    const conviction = thesis?.conviction || null
    const stopLoss = thesis?.stopLoss ?? null
    const pillars = thesis?.pillars || []

    let pillarSummary = ''
    if (pillars.length > 0) {
      const counts = {}
      pillars.forEach((p) => {
        const s = p.status || 'on_track'
        counts[s] = (counts[s] || 0) + 1
      })
      pillarSummary = Object.entries(counts)
        .map(([status, count]) => `${count}/${pillars.length} ${status}`)
        .join(', ')
    }

    const stopLossDistance = stopLoss && h.price ? ((h.price - stopLoss) / h.price) * 100 : null

    return {
      code: h.code,
      name: h.name,
      price: h.price,
      conviction,
      pillarSummary,
      stopLoss,
      stopLossDistance,
    }
  })
}

/**
 * Format institutional flow data
 */
export function buildInstitutionalSummary(institutional) {
  if (!institutional) return null
  return {
    foreign: institutional.foreign || null,
    investment: institutional.investment || null,
    dealer: institutional.dealer || null,
  }
}

/**
 * Find watchlist stocks near entry price (within 5%)
 */
export function buildWatchlistAlerts(watchlist, threshold = 5) {
  if (!Array.isArray(watchlist)) return []

  return watchlist
    .filter((w) => {
      if (!w.entryPrice || !w.currentPrice) return false
      const distance = ((w.currentPrice - w.entryPrice) / w.entryPrice) * 100
      return distance >= -threshold && distance <= threshold
    })
    .map((w) => ({
      code: w.code,
      name: w.name,
      entryPrice: w.entryPrice,
      currentPrice: w.currentPrice,
      distance: ((w.currentPrice - w.entryPrice) / w.entryPrice) * 100,
      nearEntry: true,
    }))
}

/**
 * Assemble complete morning note from all data sources
 */
export function buildMorningNote({
  holdings = [],
  theses = [],
  events = [],
  watchlist = [],
  institutional = null,
  announcements = [],
  today = null,
}) {
  const dateStr = today || new Date().toISOString().slice(0, 10).replace(/-/g, '/')

  return {
    date: dateStr,
    sections: {
      todayEvents: buildTodayEvents(events, theses, dateStr),
      holdingStatus: buildHoldingStatus(holdings, theses),
      institutional: buildInstitutionalSummary(institutional),
      watchlistAlerts: buildWatchlistAlerts(watchlist),
      announcements: announcements || [],
    },
  }
}

/**
 * Render morning note as plain text (for AI prompt or export)
 */
export function renderMorningNotePlainText(note) {
  if (!note) return ''
  const { date, sections } = note
  const lines = [`每日交易備忘 — ${date}`, '']

  if (sections.todayEvents?.length > 0) {
    lines.push('── 今日事件 ──')
    sections.todayEvents.forEach((e) => {
      const impact = e.impactLabel ? `[${e.impactLabel}]` : ''
      const pillarNote = e.relatedPillars?.length > 0 ? '（thesis pillar 驗證點）' : ''
      lines.push(`${impact} ${e.title}${pillarNote}`)
    })
    lines.push('')
  }

  if (sections.holdingStatus?.length > 0) {
    lines.push('── 持倉狀態 ──')
    sections.holdingStatus.forEach((h) => {
      const conv = h.conviction ? `conviction:${h.conviction.toUpperCase()}` : ''
      const stop = h.stopLossDistance != null ? `距停損 +${h.stopLossDistance.toFixed(1)}%` : ''
      const pillars = h.pillarSummary || ''
      lines.push(`${h.name}  ${conv}  昨收 ${h.price}  ${stop}  ${pillars}`.trim())
    })
    lines.push('')
  }

  if (sections.institutional) {
    lines.push('── 法人動態 ──')
    const inst = sections.institutional
    if (inst.foreign) lines.push(`外資 淨買超 ${inst.foreign.net?.toLocaleString() || 0}`)
    if (inst.investment) lines.push(`投信 淨買超 ${inst.investment.net?.toLocaleString() || 0}`)
    if (inst.dealer) lines.push(`自營 淨買超 ${inst.dealer.net?.toLocaleString() || 0}`)
    lines.push('')
  }

  if (sections.watchlistAlerts?.length > 0) {
    lines.push('── 觀察股提示 ──')
    sections.watchlistAlerts.forEach((w) => {
      lines.push(`${w.name}(${w.code}) 接近進場價 ${w.entryPrice}（目前 ${w.currentPrice}）`)
    })
    lines.push('')
  }

  if (sections.announcements?.length > 0) {
    lines.push('── 重大訊息 ──')
    sections.announcements.forEach((a) => {
      lines.push(`${a.code} ${a.name}：${a.title}`)
    })
    lines.push('')
  }

  return lines.join('\n')
}
