import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { IND_COLOR, STOCK_META } from '../../seedData.js'
import { Card } from '../common'
import { getHoldingMarketValue, getHoldingReturnPct, getHoldingUnrealizedPnl } from '../../lib/holdings.js'

/* ── 是枝裕和《小偷家族》×《海街日記》融合美學 ──
 * 1. 極微色底取代漸層，邊框完全移除
 * 2. 字重降至 400–500，字距加大，數字「呼吸」
 * 3. 移除所有 boxShadow，用 24px 間距取代邊線
 * 4. Emoji 全部移除，改為純文字標題 + 寬字距
 * 5. 色彩極淡化，只有數字本身帶色
 */

const sectionTitle = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.12em',
  fontWeight: 400,
  marginBottom: 12,
  textTransform: 'uppercase',
}

/**
 * Holdings Summary — 溫暖極簡 Hero
 */
export function HoldingsSummary({ holdings, totalVal, totalCost }) {
  const totalPnl = totalVal - totalCost
  const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0
  const isUp = totalPnl >= 0
  const heroColor = isUp ? C.up : C.down

  return h(
    'div',
    { style: { marginBottom: 24 } },

    // Hero — 極微色底，無邊框，無陰影
    h(
      'div',
      {
        style: {
          background: alpha(heroColor, '06'),
          borderRadius: 12,
          padding: '24px 20px',
          marginBottom: 16,
          textAlign: 'center',
        },
      },
      h('div', {
        style: {
          fontSize: 10,
          color: C.textMute,
          letterSpacing: '0.12em',
          marginBottom: 10,
          fontWeight: 400,
        },
      }, '總 損 益'),
      h(
        'div',
        {
          className: 'tn',
          style: {
            fontSize: 28,
            fontWeight: 500,
            color: heroColor,
            lineHeight: 1.3,
            letterSpacing: '0.02em',
          },
        },
        `${isUp ? '+' : ''}${Math.round(totalPnl).toLocaleString()}`
      ),
      h(
        'div',
        {
          style: {
            marginTop: 8,
            fontSize: 12,
            fontWeight: 400,
            color: heroColor,
            opacity: 0.7,
            letterSpacing: '0.04em',
          },
        },
        `${isUp ? '+' : ''}${totalPct.toFixed(2)}%`
      )
    ),

    // Sub-metrics — 無邊框，純文字排列
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'space-around', padding: '0 8px' } },
      [
        ['總成本', totalCost.toLocaleString()],
        ['總市值', totalVal.toLocaleString()],
        ['持股', `${holdings.length} 檔`],
      ].map(([label, value]) =>
        h(
          'div',
          { key: label, style: { textAlign: 'center' } },
          h('div', {
            style: {
              fontSize: 9,
              color: C.textMute,
              letterSpacing: '0.1em',
              marginBottom: 4,
              fontWeight: 400,
            },
          }, label),
          h('div', {
            className: 'tn',
            style: {
              fontSize: 13,
              fontWeight: 500,
              color: C.textSec,
              letterSpacing: '0.02em',
            },
          }, value)
        )
      )
    )
  )
}

/**
 * Holdings Integrity Warning — 保持功能，簡化視覺
 */
export function HoldingsIntegrityWarning({ issues }) {
  if (!issues || issues.length === 0) return null

  return h(
    'div',
    {
      style: {
        marginBottom: 24,
        padding: '10px 14px',
        fontSize: 10,
        color: C.amber,
        lineHeight: 1.7,
        borderLeft: `1px solid ${alpha(C.amber, '20')}`,
        background: alpha(C.amber, '04'),
        borderRadius: 4,
      },
    },
    `${issues.length} 檔持股缺少可用價格，市值可能暫時不完整 — `,
    issues
      .slice(0, 5)
      .map((item) => `${item.name || item.code}`)
      .join('、'),
    issues.length > 5 ? ' …' : '',
    '。請同步收盤價。'
  )
}

/**
 * Portfolio Health Check — 灰階產業條 + 最大產業主題色
 */
export function PortfolioHealthCheck({ holdings }) {
  if (!holdings || holdings.length === 0) return null

  const indMap = {}
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    indMap[m.industry] = (indMap[m.industry] || 0) + getHoldingMarketValue(item)
  })
  const indArr = Object.entries(indMap).sort((a, b) => b[1] - a[1])
  const indTotal = indArr.reduce((s, x) => s + x[1], 0) || 1

  const stratMap = {}
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    stratMap[m.strategy] = (stratMap[m.strategy] || 0) + 1
  })

  const periodMap = {}
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    periodMap[m.period] = (periodMap[m.period] || 0) + 1
  })

  const posMap = {}
  holdings.forEach((item) => {
    const m = STOCK_META[item.code]
    if (!m) return
    posMap[m.position] = (posMap[m.position] || 0) + getHoldingMarketValue(item)
  })

  const warnings = indArr.filter(([ind, val]) => {
    const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length
    return count >= 3 || val / indTotal > 0.25
  })

  return h(
    'div',
    { style: { marginBottom: 24 } },
    h('div', { style: sectionTitle }, '投 組 健 檢'),

    // Industry bar — 灰階為主，最大產業用原色
    h(
      'div',
      {
        style: {
          display: 'flex',
          borderRadius: 3,
          overflow: 'hidden',
          height: 6,
          marginBottom: 14,
          background: alpha(C.textMute, '10'),
        },
      },
      indArr.map(([ind, val], i) =>
        h('div', {
          key: ind,
          style: {
            width: `${(val / indTotal) * 100}%`,
            height: '100%',
            background: i === 0 ? (IND_COLOR[ind] || C.teal) : alpha(C.textMute, '25'),
            transition: 'width 0.4s ease',
          },
        })
      )
    ),

    // Industry labels — 簡約小標籤
    h(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 } },
      indArr.map(([ind, val], i) => {
        const pct = ((val / indTotal) * 100).toFixed(0)
        const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length
        const isTop = i === 0
        return h(
          'span',
          {
            key: ind,
            style: {
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 4,
              color: isTop ? C.text : C.textMute,
              background: isTop ? alpha(IND_COLOR[ind] || C.teal, '10') : 'transparent',
              fontWeight: isTop ? 500 : 400,
              letterSpacing: '0.02em',
            },
          },
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
            borderLeft: `2px solid ${alpha(C.amber, '30')}`,
            background: alpha(C.amber, '04'),
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 14,
            fontSize: 10,
            color: C.amber,
            lineHeight: 1.6,
            fontWeight: 400,
          },
        },
        '產業集中：',
        warnings
          .map(([ind]) => {
            const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length
            return `${ind}(${count}檔)`
          })
          .join('、'),
        warnings.some(([, val]) => val / indTotal > 0.3) && ' — 建議分散風險'
      ),

    // Three column distributions — 無邊框，純文字
    h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
      h(
        'div',
        null,
        h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 } }, '策略'),
        Object.entries(stratMap)
          .sort((a, b) => b[1] - a[1])
          .map(([s, n]) =>
            h(
              'div',
              { key: s, style: { fontSize: 10, color: C.textSec, marginBottom: 3, fontWeight: 400 } },
              s,
              ' ',
              h('span', { style: { color: C.text, fontWeight: 500 } }, n)
            )
          )
      ),
      h(
        'div',
        null,
        h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 } }, '週期'),
        Object.entries(periodMap).map(([p, n]) =>
          h(
            'div',
            { key: p, style: { fontSize: 10, color: C.textSec, marginBottom: 3, fontWeight: 400 } },
            p === '短' ? '短期' : p === '中' ? '中期' : p === '短中' ? '短中期' : '中長期',
            ' ',
            h('span', { style: { color: C.text, fontWeight: 500 } }, n)
          )
        )
      ),
      h(
        'div',
        null,
        h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 } }, '定位'),
        Object.entries(posMap)
          .sort((a, b) => b[1] - a[1])
          .map(([p, val]) =>
            h(
              'div',
              { key: p, style: { fontSize: 10, color: C.textSec, marginBottom: 3, fontWeight: 400 } },
              p,
              ' ',
              h('span', { style: { color: C.text, fontWeight: 500 } }, `${((val / indTotal) * 100).toFixed(0)}%`)
            )
          )
      )
    )
  )
}

/**
 * Top 5 Holdings — 移除圓環，改為排名數字 + 簡約進度條
 */
export function Top5Holdings({ holdings, totalVal }) {
  const top5 = [...holdings]
    .sort((a, b) => getHoldingMarketValue(b) - getHoldingMarketValue(a))
    .slice(0, 5)

  if (top5.length === 0) return null

  return h(
    'div',
    { style: { marginBottom: 24 } },
    h('div', { style: sectionTitle }, '市 值 佔 比'),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      top5.map((holding, i) => {
        const pct = (getHoldingMarketValue(holding) / Math.max(totalVal, 1)) * 100
        return h(
          'div',
          { key: holding.code },
          // Name row
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              // Rank number
              h('span', {
                style: {
                  fontSize: 11,
                  color: i === 0 ? C.teal : C.textMute,
                  fontWeight: i === 0 ? 500 : 400,
                  width: 14,
                  letterSpacing: '0.02em',
                },
              }, `${i + 1}`),
              h('span', {
                style: {
                  fontSize: 12,
                  color: C.textSec,
                  fontWeight: 400,
                  letterSpacing: '0.02em',
                },
              }, holding.name)
            ),
            h('span', {
              className: 'tn',
              style: {
                fontSize: 12,
                fontWeight: 500,
                color: i === 0 ? C.text : C.textSec,
                letterSpacing: '0.02em',
              },
            }, `${pct.toFixed(1)}%`)
          ),
          // Progress bar — 極細，溫暖
          h(
            'div',
            {
              style: {
                height: 2,
                borderRadius: 1,
                background: alpha(C.textMute, '0a'),
                overflow: 'hidden',
              },
            },
            h('div', {
              style: {
                width: `${pct}%`,
                height: '100%',
                background: i === 0 ? C.teal : alpha(C.textMute, '20'),
                borderRadius: 1,
                transition: 'width 0.4s ease',
              },
            })
          )
        )
      })
    )
  )
}

/**
 * Winners and Losers — 移除左邊色帶，純文字列表
 */
export function WinLossSummary({ winners, losers }) {
  const renderList = (items, color, prefix) =>
    h(
      'div',
      null,
      h('div', {
        style: {
          ...sectionTitle,
          color: alpha(color, '80'),
          marginBottom: 10,
        },
      }, `${prefix} ${items.length} 檔`),
      items.slice(0, 5).map((holding) => {
        const pct = getHoldingReturnPct(holding)
        return h(
          'div',
          {
            key: holding.code,
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 0',
              borderBottom: `1px solid ${alpha(C.textMute, '06')}`,
            },
          },
          h('span', {
            style: {
              fontSize: 11,
              color: C.textSec,
              fontWeight: 400,
              letterSpacing: '0.02em',
            },
          }, holding.name),
          h('span', {
            className: 'tn',
            style: {
              fontSize: 11,
              fontWeight: 500,
              color,
              letterSpacing: '0.02em',
            },
          }, `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`)
        )
      })
    )

  return h(
    'div',
    { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 } },
    renderList(winners, C.up, '獲利'),
    renderList(losers, C.down, '虧損')
  )
}

/**
 * Main Holdings Panel
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
  refreshPrices,
  refreshing = false,
  children,
}) {
  return h(
    'div',
    null,
    // Refresh button
    refreshPrices &&
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 } },
        h(
          'button',
          {
            onClick: refreshPrices,
            disabled: refreshing,
            style: {
              fontSize: 11,
              padding: '5px 12px',
              borderRadius: 6,
              border: `1px solid ${alpha(C.textMute, '20')}`,
              background: refreshing ? alpha(C.textMute, '08') : 'transparent',
              color: refreshing ? C.textMute : C.textSec,
              cursor: refreshing ? 'not-allowed' : 'pointer',
              fontWeight: 400,
              letterSpacing: '0.04em',
              transition: 'all 0.2s ease',
            },
          },
          refreshing ? '同步中…' : '刷新報價'
        )
      ),
    h(HoldingsSummary, { holdings, totalVal, totalCost }),
    h(HoldingsIntegrityWarning, { issues: holdingsIntegrityIssues }),
    h(PortfolioHealthCheck, { holdings }),
    h(Top5Holdings, { holdings, totalVal }),
    h(WinLossSummary, { winners, losers }),
    children
  )
}
