import { createElement as h } from 'react'
import { C } from '../../theme.js'
import { Card } from '../common'
import {
  getHoldingMarketValue,
  getHoldingReturnPct,
  getHoldingUnrealizedPnl,
} from '../../lib/holdings.js'

const card = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '12px 14px',
  boxShadow: `${C.insetLine}, ${C.shadow}`,
}

const lbl = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}

const pc = (p) => (p == null ? C.textMute : p >= 0 ? C.up : C.down)
const pcBg = (p) => (p == null ? 'transparent' : p >= 0 ? C.upBg : C.downBg)

/**
 * Single Holding Row
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

  return h(
    'div',
    null,
    // Main row
    h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 40px',
          gap: 8,
          alignItems: 'center',
          padding: '10px 12px',
          background: card.background,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          marginBottom: expanded ? 0 : 6,
        },
      },
      // Name + Code
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h(
          'div',
          null,
          h('div', { style: { fontSize: 11, fontWeight: 600, color: C.text } }, holding.name),
          h('div', { style: { fontSize: 9, color: C.textMute } }, holding.code)
        )
      ),

      // Qty + Cost
      h(
        'div',
        { style: { fontSize: 10, color: C.textSec } },
        h('div', null, `${holding.qty.toLocaleString()} 股`),
        h('div', { style: { fontSize: 9, color: C.textMute } }, `成本 ${holding.cost}`)
      ),

      // Price + Value
      h(
        'div',
        { style: { fontSize: 10, color: C.textSec } },
        h('div', { style: { fontWeight: 600, color: C.text } }, holding.price),
        h('div', { style: { fontSize: 9, color: C.textMute } }, value.toLocaleString())
      ),

      // P&L
      h(
        'div',
        {
          style: {
            fontSize: 10,
            fontWeight: 600,
            color: pc(pnl),
            background: pcBg(pnl),
            borderRadius: 6,
            padding: '4px 8px',
            textAlign: 'center',
          },
        },
        h('div', null, `${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}`),
        h(
          'div',
          { style: { fontSize: 9, fontWeight: 500 } },
          `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
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
            fontSize: 12,
            padding: '4px',
          },
        },
        expanded ? '▲' : '▼'
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
            borderRadius: '0 0 8px 8px',
            padding: '10px 12px',
            marginBottom: 6,
          },
        },
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
          // Target price
          h(
            'div',
            null,
            h('div', { style: { ...lbl, marginBottom: 3 } }, '目標價'),
            h('input', {
              type: 'number',
              value: holding.targetPrice || '',
              onChange: (e) =>
                onUpdateTarget(holding.code, e.target.value ? Number(e.target.value) : null),
              placeholder: '輸入目標價',
              style: {
                width: '100%',
                background: C.subtle,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: '6px 8px',
                color: C.text,
                fontSize: 11,
              },
            })
          ),

          // Alert
          h(
            'div',
            null,
            h('div', { style: { ...lbl, marginBottom: 3 } }, '警報'),
            h('input', {
              type: 'text',
              value: holding.alert || '',
              onChange: (e) => onUpdateAlert(holding.code, e.target.value),
              placeholder: '如：跌破月線',
              style: {
                width: '100%',
                background: C.subtle,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: '6px 8px',
                color: C.text,
                fontSize: 11,
              },
            })
          )
        ),

        // Additional info
        holding.type &&
          h(
            'div',
            { style: { fontSize: 9, color: C.textMute, marginTop: 8 } },
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
      { style: { ...card, textAlign: 'center', padding: '32px 16px' } },
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
    h('div', { style: { ...lbl, marginBottom: 8 } }, `持股明細 · ${holdings.length}檔`),

    // Header
    h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 40px',
          gap: 8,
          padding: '8px 12px',
          fontSize: 9,
          color: C.textMute,
          fontWeight: 600,
          letterSpacing: '0.05em',
        },
      },
      h('div', null, '股票'),
      h('div', null, '數量 / 成本'),
      h('div', null, '股價 / 市值'),
      h('div', null, '損益'),
      h('div', null, '')
    ),

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
