import { createElement as h } from 'react'
import { C } from '../../theme.js'
import { STOCK_META } from '../../seedData.js'
import { Card } from '../common'
import {
  getHoldingMarketValue,
  getHoldingReturnPct,
  getHoldingUnrealizedPnl,
} from '../../lib/holdings.js'

const lbl = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}

const pc = (p) => (p == null ? C.textMute : p >= 0 ? C.up : C.down)
const pcBg = (p) => (p == null ? 'transparent' : p >= 0 ? C.upBg : C.downBg)

/** Period label helper */
const periodLabel = (p) => {
  if (p === '短') return '短線'
  if (p === '中') return '中線'
  if (p === '短中') return '短中'
  if (p === '中長') return '中長'
  return p || ''
}

/** Period tag color */
const periodColor = (p) => {
  if (p === '短') return C.orange
  if (p === '中') return C.blue
  if (p === '短中') return C.amber
  return C.teal
}

/**
 * Single Holding Row — 3-row stacked layout (mobile-first)
 */
export function HoldingRow({
  holding,
  expanded = false,
  onToggle = () => {},
  onUpdateTarget = () => {},
  onUpdateAlert = () => {},
}) {
  const pnl = getHoldingUnrealizedPnl(holding)
  const pct = getHoldingReturnPct(holding)
  const value = getHoldingMarketValue(holding)
  const meta = STOCK_META[holding.code]
  const qty = Number(holding.qty) || 0
  const cost = Number(holding.cost) || 0

  // PnL bar width (relative, max 60px)
  const absPct = Math.min(Math.abs(pct), 30) // cap at 30%
  const barW = (absPct / 30) * 60

  return h(
    'div',
    { style: { marginBottom: expanded ? 0 : 6 } },

    // Main card
    h(
      'div',
      {
        style: {
          background: C.card,
          border: `1px solid ${C.borderSoft}`,
          borderRadius: expanded ? '10px 10px 0 0' : 10,
          padding: '12px 14px',
          transition: 'background 0.15s',
        },
      },

      // Row 1: Name + Code + Tags + Expand button
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
          { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 } },
          h('span', { style: { fontSize: 13, fontWeight: 600, color: C.text } }, holding.name),
          h('span', { style: { fontSize: 10, color: C.textMute } }, holding.code),
          // Period tag
          meta?.period && h(
            'span',
            {
              style: {
                fontSize: 9,
                fontWeight: 600,
                color: periodColor(meta.period),
                background: `${periodColor(meta.period)}12`,
                borderRadius: 4,
                padding: '1px 5px',
              },
            },
            periodLabel(meta.period)
          ),
          // Position tag
          meta?.position && h(
            'span',
            {
              style: {
                fontSize: 9,
                fontWeight: 500,
                color: C.textMute,
                background: C.subtle,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: '1px 5px',
              },
            },
            meta.position
          )
        ),
        // Expand button
        h(
          'button',
          {
            onClick: onToggle,
            style: {
              background: 'transparent',
              border: 'none',
              color: C.textMute,
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 6px',
              borderRadius: 4,
              transition: 'background 0.15s',
            },
          },
          expanded ? '▲' : '▼'
        )
      ),

      // Row 2: Industry + Strategy (low brightness)
      meta && h(
        'div',
        {
          style: {
            fontSize: 10,
            color: C.textMute,
            marginBottom: 8,
            display: 'flex',
            gap: 8,
          },
        },
        meta.industry && h('span', null, meta.industry),
        meta.strategy && h('span', null, meta.strategy)
      ),

      // Row 3: Financial data row
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          },
        },
        // Qty · Cost · Price
        h(
          'div',
          { style: { display: 'flex', gap: 10, fontSize: 11, color: C.textSec } },
          h('span', null, `${qty.toLocaleString()}股`),
          h('span', { style: { color: C.textMute } }, `成本 ${cost}`),
          h('span', { style: { fontWeight: 600, color: C.text } }, holding.price),
          h('span', { style: { fontSize: 10, color: C.textMute } }, value.toLocaleString())
        ),
        // PnL pill + mini bar
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            },
          },
          // Mini color bar
          h('div', {
            style: {
              width: Math.max(barW, 3),
              height: 4,
              borderRadius: 2,
              background: pc(pnl),
              opacity: 0.6,
              flexShrink: 0,
            },
          }),
          // PnL value
          h(
            'div',
            {
              style: {
                fontSize: 11,
                fontWeight: 700,
                color: pc(pnl),
                background: pcBg(pnl),
                borderRadius: 6,
                padding: '3px 8px',
                textAlign: 'right',
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
              },
            },
            h('span', null, `${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}`),
            h('span', { style: { fontSize: 10, fontWeight: 500, opacity: 0.85, marginLeft: 4 } }, `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`)
          )
        )
      )
    ),

    // Expanded details
    expanded &&
      h(
        'div',
        {
          style: {
            background: C.subtle,
            border: `1px solid ${C.border}`,
            borderTop: 'none',
            borderRadius: '0 0 10px 10px',
            padding: '12px 14px',
            marginBottom: 6,
          },
        },
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
          // Target price
          h(
            'div',
            null,
            h('div', { style: { ...lbl, marginBottom: 4 } }, '🎯 目標價'),
            h('input', {
              type: 'number',
              value: holding.targetPrice || '',
              onChange: (e) =>
                onUpdateTarget(holding.code, e.target.value ? Number(e.target.value) : null),
              placeholder: '輸入目標價',
              style: {
                width: '100%',
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: '8px 10px',
                color: C.text,
                fontSize: 12,
                outline: 'none',
                transition: 'border-color 0.15s',
              },
            }),
            // Target distance hint
            holding.targetPrice && holding.price && h(
              'div',
              {
                style: {
                  fontSize: 9,
                  color: holding.price < holding.targetPrice ? C.up : C.down,
                  marginTop: 3,
                },
              },
              `距目標 ${(((holding.targetPrice - holding.price) / holding.price) * 100).toFixed(1)}%`
            )
          ),

          // Alert
          h(
            'div',
            null,
            h('div', { style: { ...lbl, marginBottom: 4 } }, '🔔 警報'),
            h('input', {
              type: 'text',
              value: holding.alert || '',
              onChange: (e) => onUpdateAlert(holding.code, e.target.value),
              placeholder: '如：跌破月線',
              style: {
                width: '100%',
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: '8px 10px',
                color: C.text,
                fontSize: 12,
                outline: 'none',
                transition: 'border-color 0.15s',
              },
            })
          )
        ),

        // Additional info
        holding.type &&
          h(
            'div',
            { style: { fontSize: 10, color: C.textMute, marginTop: 10 } },
            '類型：',
            holding.type
          )
      )
  )
}

/**
 * Holdings Table
 */
export function HoldingsTable({
  holdings = [],
  expandedStock = null,
  setExpandedStock = () => {},
  onUpdateTarget = () => {},
  onUpdateAlert = () => {},
  sortBy = 'code',
  sortDir = 'asc',
}) {
  if (!holdings || holdings.length === 0) {
    return h(
      'div',
      {
        style: {
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '32px 16px',
          textAlign: 'center',
          boxShadow: C.shadow,
        },
      },
      h('div', { style: { fontSize: 28, marginBottom: 8, opacity: 0.6 } }, '∅'),
      h('div', { style: { fontSize: 11, color: C.textSec, fontWeight: 600 } }, '尚無持股'),
      h(
        'div',
        { style: { fontSize: 10, color: C.textMute, marginTop: 4 } },
        '上傳成交記錄或手動新增持股'
      )
    )
  }

  // Sort holdings
  const sorted = [...holdings].sort((a, b) => {
    let aVal, bVal
    switch (sortBy) {
      case 'code':
        aVal = a.code
        bVal = b.code
        break
      case 'value':
        aVal = getHoldingMarketValue(a)
        bVal = getHoldingMarketValue(b)
        break
      case 'pnl':
        aVal = getHoldingUnrealizedPnl(a)
        bVal = getHoldingUnrealizedPnl(b)
        break
      case 'pct':
        aVal = getHoldingReturnPct(a)
        bVal = getHoldingReturnPct(b)
        break
      default:
        aVal = a.code
        bVal = b.code
    }
    if (sortDir === 'asc') {
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    }
    return aVal > bVal ? -1 : aVal < bVal ? 1 : 0
  })

  return h(
    Card,
    null,
    h('div', { style: { ...lbl, marginBottom: 10 } }, `📋 持股明細 · ${holdings.length}檔`),

    // Rows
    h(
      'div',
      null,
      sorted.map((holding) =>
        h(HoldingRow, {
          key: holding.code,
          holding,
          expanded: expandedStock === holding.code,
          onToggle: () => setExpandedStock(expandedStock === holding.code ? null : holding.code),
          onUpdateTarget,
          onUpdateAlert,
        })
      )
    )
  )
}
