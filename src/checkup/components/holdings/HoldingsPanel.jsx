import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { IND_COLOR, STOCK_META } from '../../seedData.js'
import { Card } from '../common'
import { getHoldingMarketValue, getHoldingReturnPct, getHoldingUnrealizedPnl } from '../../lib/holdings.js'

const lbl = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}
const metricCard = {
  background: C.card,
  border: `1px solid ${C.borderSoft}`,
  borderRadius: 10,
  padding: '10px 12px',
  boxShadow: C.shadow,
}

/**
 * Holdings Summary Metrics — Hero PnL card + sub-metrics
 */
export function HoldingsSummary({ holdings, totalVal, totalCost }) {
  const totalPnl = totalVal - totalCost
  const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0
  const isUp = totalPnl >= 0

  const heroColor = isUp ? C.up : C.down
  const heroGradient = `linear-gradient(135deg, ${alpha(heroColor, '1f')} 0%, ${alpha(heroColor, '08')} 100%)`
  const heroBorder = `1px solid ${alpha(heroColor, '26')}`

  const subMetrics = [
    ['總成本', totalCost.toLocaleString(), C.textSec],
    ['總市值', totalVal.toLocaleString(), C.blue],
    ['持股數', `${holdings.length}檔`, C.lavender],
  ]

  return h(
    'div',
    { style: { marginBottom: 14 } },

    // Hero PnL Card
    h(
      'div',
      {
        style: {
          background: heroGradient,
          border: heroBorder,
          borderRadius: 14,
          padding: '18px 20px',
          marginBottom: 10,
          textAlign: 'center',
        },
      },
      h('div', { style: { fontSize: 10, color: C.textMute, letterSpacing: '0.08em', marginBottom: 6 } }, '總損益'),
      h(
        'div',
        {
          className: 'tn',
          style: {
            fontSize: 28,
            fontWeight: 700,
            color: isUp ? C.up : C.down,
            lineHeight: 1.2,
          },
        },
        `${isUp ? '+' : ''}${Math.round(totalPnl).toLocaleString()}`
      ),
      h(
        'span',
        {
          style: {
            display: 'inline-block',
            marginTop: 6,
            fontSize: 12,
            fontWeight: 600,
            color: isUp ? C.up : C.down,
            background: isUp ? C.upBg : C.downBg,
            borderRadius: 20,
            padding: '3px 12px',
          },
        },
        `${isUp ? '+' : ''}${totalPct.toFixed(2)}%`
      )
    ),

    // Sub-metrics row
    h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
      subMetrics.map(([label, value, color]) =>
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
        marginBottom: 14,
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
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    indMap[m.industry] = (indMap[m.industry] || 0) + getHoldingMarketValue(item)
  })
  const indArr = Object.entries(indMap).sort((a, b) => b[1] - a[1])
  const indTotal = indArr.reduce((s, x) => s + x[1], 0) || 1

  // Strategy distribution
  const stratMap = {}
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    stratMap[m.strategy] = (stratMap[m.strategy] || 0) + 1
  })

  // Period distribution
  const periodMap = {}
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    periodMap[m.period] = (periodMap[m.period] || 0) + 1
  })

  // Position distribution
  const posMap = {}
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    posMap[m.position] = (posMap[m.position] || 0) + getHoldingMarketValue(item)
  })

  // Industry concentration warnings
  const warnings = indArr.filter(([ind, val]) => {
    const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length
    return count >= 3 || val / indTotal > 0.25
  })

  return h(
    Card,
    { style: { marginBottom: 14 } },
    h('div', { style: lbl }, '🏥 投組健檢'),

    // Industry bar — enhanced height + rounded
    h(
      'div',
      {
        style: {
          display: 'flex',
          borderRadius: 5,
          overflow: 'hidden',
          height: 10,
          marginBottom: 10,
        },
      },
      indArr.map(([ind, val]) =>
        h('div', {
          key: ind,
          style: {
            width: `${(val / indTotal) * 100}%`,
            height: '100%',
            background: IND_COLOR[ind] || C.textMute,
            transition: 'width 0.3s ease',
          },
        })
      )
    ),

    // Industry labels
    h(
      'div',
      { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 } },
      indArr.map(([ind, val]) => {
        const pct = ((val / indTotal) * 100).toFixed(0)
        const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length
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
              padding: '4px 9px',
              borderRadius: 6,
              background: C.subtle,
              border: `1px solid ${C.border}`,
              color: C.textSec,
              transition: 'background 0.15s',
            },
          },
          h('span', {
            style: { width: 7, height: 7, borderRadius: 4, background: color, flexShrink: 0 },
          }),
          `${ind} ${count}檔 ${pct}%`
        )
      })
    ),

    // Warnings — with amber gradient top border
    warnings.length > 0 &&
      h(
        'div',
        {
          style: {
            background: C.amberBg,
            border: `1px solid ${alpha(C.amber, '20')}`,
            borderTop: `2px solid ${C.amber}`,
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 10,
            fontSize: 10,
            color: C.amber,
            lineHeight: 1.6,
          },
        },
        '⚠️ 產業集中：',
        warnings
          .map(([ind]) => {
            const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length
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
 * Top 5 Holdings by Market Value — with micro arc progress
 */
export function Top5Holdings({ holdings, totalVal }) {
  const top5 = [...holdings]
    .sort((a, b) => getHoldingMarketValue(b) - getHoldingMarketValue(a))
    .slice(0, 5)

  if (top5.length === 0) return null

  return h(
    Card,
    { style: { marginBottom: 14 } },
    h('div', { style: lbl }, '📊 市值佔比 Top 5'),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      top5.map((holding) => {
        const pct = (getHoldingMarketValue(holding) / Math.max(totalVal, 1)) * 100
        return h(
          'div',
          {
            key: holding.code,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: C.subtle,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: '8px 12px',
            },
          },
          // Mini arc / circle progress
          h(
            'div',
            {
              style: {
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: `conic-gradient(${C.blue} ${pct * 3.6}deg, ${C.borderSoft} ${pct * 3.6}deg)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              },
            },
            h('div', {
              style: {
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: C.subtle,
              },
            })
          ),
          // Name
          h('span', { style: { fontSize: 12, color: C.textSec, fontWeight: 500, flex: 1 } }, holding.name),
          // Percentage
          h(
            'span',
            { style: { fontSize: 13, fontWeight: 700, color: C.text } },
            `${pct.toFixed(1)}%`
          )
        )
      })
    )
  )
}

/**
 * Winners and Losers Summary — with mini color bars
 */
export function WinLossSummary({ winners, losers }) {
  const maxWinPct = winners.length > 0 ? Math.max(...winners.slice(0, 5).map(w => Math.abs(getHoldingReturnPct(w)))) : 1
  const maxLosePct = losers.length > 0 ? Math.max(...losers.slice(0, 5).map(l => Math.abs(getHoldingReturnPct(l)))) : 1

  return h(
    'div',
    { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 } },
    h(
      Card,
      {
        style: {
          borderLeft: `3px solid ${alpha(C.up, '40')}`,
          padding: '10px 12px',
        },
      },
      h('div', { style: { ...lbl, color: C.up, marginBottom: 6 } }, `📈 獲利 ${winners.length}檔`),
      winners
        .slice(0, 5)
        .map((holding) => {
          const pct = getHoldingReturnPct(holding)
          const barW = Math.min((Math.abs(pct) / Math.max(maxWinPct, 0.01)) * 100, 100)
          return h(
            'div',
            {
              key: holding.code,
              style: { marginTop: 5 },
            },
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 2 } },
              h('span', { style: { fontSize: 11, color: C.textSec } }, holding.name),
              h(
                'span',
                { style: { fontSize: 12, fontWeight: 700, color: C.up } },
                `+${pct.toFixed(2)}%`
              )
            ),
            // Mini color bar
            h('div', {
              style: {
                height: 3,
                borderRadius: 2,
                background: C.upBg,
                overflow: 'hidden',
              },
            },
              h('div', {
                style: {
                  width: `${barW}%`,
                  height: '100%',
                  background: C.up,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                },
              })
            )
          )
        })
    ),
    h(
      Card,
      {
        style: {
          borderLeft: `3px solid ${alpha(C.down, '40')}`,
          padding: '10px 12px',
        },
      },
      h('div', { style: { ...lbl, color: C.down, marginBottom: 6 } }, `📉 虧損 ${losers.length}檔`),
      losers
        .slice(0, 5)
        .map((holding) => {
          const pct = getHoldingReturnPct(holding)
          const barW = Math.min((Math.abs(pct) / Math.max(maxLosePct, 0.01)) * 100, 100)
          return h(
            'div',
            {
              key: holding.code,
              style: { marginTop: 5 },
            },
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 2 } },
              h('span', { style: { fontSize: 11, color: C.textSec } }, holding.name),
              h(
                'span',
                { style: { fontSize: 12, fontWeight: 700, color: C.down } },
                `${pct.toFixed(2)}%`
              )
            ),
            // Mini color bar
            h('div', {
              style: {
                height: 3,
                borderRadius: 2,
                background: C.downBg,
                overflow: 'hidden',
              },
            },
              h('div', {
                style: {
                  width: `${barW}%`,
                  height: '100%',
                  background: C.down,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                },
              })
            )
          )
        })
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
