import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { IND_COLOR, STOCK_META } from '../../seedData.js'
import { Card } from '../common'
import { getHoldingMarketValue, getHoldingReturnPct } from '../../lib/holdings.js'

const lbl = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}
const metricCard = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '8px 11px',
  boxShadow: `${C.insetLine}, ${C.shadow}`,
}

/**
 * Holdings Summary Metrics
 */
export function HoldingsSummary({ holdings, totalVal, totalCost }) {
  const metrics = [
    ['總成本', totalCost.toLocaleString(), C.textSec],
    ['總市值', totalVal.toLocaleString(), C.blue],
    ['持股數', `${holdings.length}檔`, C.lavender],
  ]

  return h(
    'div',
    {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 },
    },
    metrics.map(([label, value, color]) =>
      h(
        'div',
        { key: label, className: 'ui-card', style: metricCard },
        h('div', { style: { fontSize: 9, color: C.textMute, letterSpacing: '0.08em' } }, label),
        h(
          'div',
          {
            className: 'tn',
            style: {
              fontSize: 14,
              fontWeight: 600,
              color: label === '總市值' ? C.text : label === '持股數' ? C.textSec : color,
              marginTop: 2,
            },
          },
          value
        )
      )
    )
  )
}

/**
 * Holdings Integrity Warning
 */
export function HoldingsIntegrityWarning({ issues }) {
  if (!issues || issues.length === 0) return null

  return h(
    'div',
    {
      style: {
        ...metricCard,
        marginBottom: 8,
        borderLeft: `3px solid ${alpha(C.amber, '40')}`,
        padding: '8px 10px',
        fontSize: 10,
        color: C.amber,
        lineHeight: 1.7,
      },
    },
    `偵測到 ${issues.length} 檔持股缺少可用價格，市值可能暫時不完整： `,
    issues
      .slice(0, 5)
      .map((item) => `${item.name || item.code}(${item.code})`)
      .join('、'),
    issues.length > 5 ? '…' : '',
    '。請先按一次「收盤價」同步，若仍存在代表這些資料需要手動修補。'
  )
}

/**
 * Portfolio Health Check
 */
export function PortfolioHealthCheck({ holdings }) {
  if (!holdings || holdings.length === 0) return null

  // Industry distribution
  const indMap = {}
  holdings.forEach((h) => {
    const m = STOCK_META[h.code]
    if (!m) return
    indMap[m.industry] = (indMap[m.industry] || 0) + getHoldingMarketValue(h)
  })
  const indArr = Object.entries(indMap).sort((a, b) => b[1] - a[1])
  const indTotal = indArr.reduce((s, x) => s + x[1], 0) || 1

  // Strategy distribution
  const stratMap = {}
  holdings.forEach((h) => {
    const m = STOCK_META[h.code]
    if (!m) return
    stratMap[m.strategy] = (stratMap[m.strategy] || 0) + 1
  })

  // Period distribution
  const periodMap = {}
  holdings.forEach((h) => {
    const m = STOCK_META[h.code]
    if (!m) return
    periodMap[m.period] = (periodMap[m.period] || 0) + 1
  })

  // Position distribution
  const posMap = {}
  holdings.forEach((h) => {
    const m = STOCK_META[h.code]
    if (!m) return
    posMap[m.position] = (posMap[m.position] || 0) + getHoldingMarketValue(h)
  })

  // Industry concentration warnings
  const warnings = indArr.filter(([ind, val]) => {
    const count = holdings.filter((h) => STOCK_META[h.code]?.industry === ind).length
    return count >= 3 || val / indTotal > 0.25
  })

  return h(
    Card,
    { style: { marginBottom: 8 } },
    h('div', { style: lbl }, '投組健檢'),

    // Industry bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          borderRadius: 4,
          overflow: 'hidden',
          height: 6,
          marginBottom: 8,
        },
      },
      indArr.map(([ind, val]) =>
        h('div', {
          key: ind,
          style: {
            width: `${(val / indTotal) * 100}%`,
            height: '100%',
            background: IND_COLOR[ind] || C.textMute,
          },
        })
      )
    ),

    // Industry labels
    h(
      'div',
      { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 } },
      indArr.map(([ind, val]) => {
        const pct = ((val / indTotal) * 100).toFixed(0)
        const count = holdings.filter((h) => STOCK_META[h.code]?.industry === ind).length
        const color = IND_COLOR[ind] || C.textMute
        return h(
          'span',
          {
            key: ind,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 6,
              background: C.subtle,
              border: `1px solid ${C.border}`,
              color: C.textSec,
            },
          },
          h('span', {
            style: { width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 },
          }),
          `${ind} ${count}檔 ${pct}%`
        )
      })
    ),

    // Warnings
    warnings.length > 0 &&
      h(
        'div',
        {
          style: {
            background: C.amberBg,
            border: `1px solid ${alpha(C.amber, '20')}`,
            borderRadius: 6,
            padding: '6px 10px',
            marginBottom: 8,
            fontSize: 10,
            color: C.amber,
            lineHeight: 1.6,
          },
        },
        '⚠ 產業集中：',
        warnings
          .map(([ind]) => {
            const count = holdings.filter((h) => STOCK_META[h.code]?.industry === ind).length
            return `${ind}(${count}檔)`
          })
          .join('、'),
        warnings.some(([, val]) => val / indTotal > 0.3) && ' — 建議分散風險'
      ),

    // Three column distributions
    h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 } },
      h(
        'div',
        null,
        h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 4 } }, '策略框架'),
        Object.entries(stratMap)
          .sort((a, b) => b[1] - a[1])
          .map(([s, n]) =>
            h(
              'div',
              { key: s, style: { fontSize: 10, color: C.textSec, marginBottom: 2 } },
              s,
              ' ',
              h('span', { style: { color: C.text, fontWeight: 600 } }, n)
            )
          )
      ),
      h(
        'div',
        null,
        h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 4 } }, '持有週期'),
        Object.entries(periodMap).map(([p, n]) =>
          h(
            'div',
            { key: p, style: { fontSize: 10, color: C.textSec, marginBottom: 2 } },
            p === '短' ? '短期' : p === '中' ? '中期' : p === '短中' ? '短中期' : '中長期',
            ' ',
            h('span', { style: { color: C.text, fontWeight: 600 } }, n)
          )
        )
      ),
      h(
        'div',
        null,
        h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 4 } }, '持倉定位'),
        Object.entries(posMap)
          .sort((a, b) => b[1] - a[1])
          .map(([p, val]) =>
            h(
              'div',
              { key: p, style: { fontSize: 10, color: C.textSec, marginBottom: 2 } },
              p,
              ' ',
              h(
                'span',
                { style: { color: C.text, fontWeight: 600 } },
                `${((val / indTotal) * 100).toFixed(0)}%`
              )
            )
          )
      )
    )
  )
}

/**
 * Top 5 Holdings by Market Value
 */
export function Top5Holdings({ holdings, totalVal }) {
  const top5 = [...holdings]
    .sort((a, b) => getHoldingMarketValue(b) - getHoldingMarketValue(a))
    .slice(0, 5)

  if (top5.length === 0) return null

  return h(
    Card,
    { style: { marginBottom: 8 } },
    h('div', { style: lbl }, '市值佔比 Top 5'),
    h(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      top5.map((holding) => {
        const pct = (getHoldingMarketValue(holding) / Math.max(totalVal, 1)) * 100
        return h(
          'div',
          {
            key: holding.code,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: C.subtle,
              border: `1px solid ${C.border}`,
              borderRadius: 20,
              padding: '4px 10px',
            },
          },
          h('span', { style: { fontSize: 11, color: C.textSec, fontWeight: 500 } }, holding.name),
          h(
            'span',
            { style: { fontSize: 11, fontWeight: 700, color: C.text } },
            `${pct.toFixed(1)}%`
          )
        )
      })
    )
  )
}

/**
 * Winners and Losers Summary
 */
export function WinLossSummary({ winners, losers }) {
  return h(
    'div',
    { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 } },
    h(
      Card,
      {
        style: {
          borderLeft: `3px solid ${alpha(C.up, '40')}`,
          padding: '8px 10px',
        },
      },
      h('div', { style: { ...lbl, color: C.up, marginBottom: 3 } }, `獲利 ${winners.length}檔`),
      winners
        .slice(0, 3)
        .map((holding) =>
          h(
            'div',
            {
              key: holding.code,
              style: { display: 'flex', justifyContent: 'space-between', marginTop: 4 },
            },
            h('span', { style: { fontSize: 11, color: C.textSec } }, holding.name),
            h(
              'span',
              { style: { fontSize: 11, fontWeight: 600, color: C.up } },
              `+${getHoldingReturnPct(holding).toFixed(2)}%`
            )
          )
        )
    ),
    h(
      Card,
      {
        style: {
          borderLeft: `3px solid ${alpha(C.down, '40')}`,
          padding: '8px 10px',
        },
      },
      h('div', { style: { ...lbl, color: C.down, marginBottom: 3 } }, `虧損 ${losers.length}檔`),
      losers
        .slice(0, 3)
        .map((holding) =>
          h(
            'div',
            {
              key: holding.code,
              style: { display: 'flex', justifyContent: 'space-between', marginTop: 4 },
            },
            h('span', { style: { fontSize: 11, color: C.textSec } }, holding.name),
            h(
              'span',
              { style: { fontSize: 11, fontWeight: 600, color: C.down } },
              `${getHoldingReturnPct(holding).toFixed(2)}%`
            )
          )
        )
    )
  )
}

/**
 * Main Holdings Panel Component
 */
export function HoldingsPanel({
  holdings = [],
  totalVal = 0,
  totalCost = 0,
  winners = [],
  losers = [],
  top5: _top5 = [],
  holdingsIntegrityIssues = [],
  showReversal: _showReversal = false,
  setShowReversal: _setShowReversal = () => {},
  reversalConditions: _reversalConditions = {},
  children,
}) {
  return h(
    'div',
    null,
    // Summary metrics
    h(HoldingsSummary, { holdings, totalVal, totalCost }),

    // Integrity warning
    h(HoldingsIntegrityWarning, { issues: holdingsIntegrityIssues }),

    // Portfolio health check
    h(PortfolioHealthCheck, { holdings }),

    // Top 5
    h(Top5Holdings, { holdings, totalVal }),

    // Win/Loss summary
    h(WinLossSummary, { winners, losers }),

    // Children (additional content like holdings table)
    children
  )
}
