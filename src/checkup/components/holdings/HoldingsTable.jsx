import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { STOCK_META } from '../../seedData.js'
import {
  getHoldingMarketValue,
  getHoldingReturnPct,
  getHoldingUnrealizedPnl,
} from '../../lib/holdings.js'

/* ── 是枝裕和《小偷家族》×《海街日記》美學 ──
 * - 移除 mini 色條，損益只用文字顏色
 * - 字重降至 400–500
 * - 移除 emoji，卡片間用間距分隔
 * - 邊框極淡化，無陰影
 */

const sectionTitle = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.12em',
  fontWeight: 400,
  marginBottom: 12,
}

const pc = (p) => (p == null ? C.textMute : p >= 0 ? C.up : C.down)

const periodLabel = (p) => {
  if (p === '短') return '短線'
  if (p === '中') return '中線'
  if (p === '短中') return '短中'
  if (p === '中長') return '中長'
  return p || ''
}

const periodColor = (p) => {
  if (p === '短') return C.orange
  if (p === '中') return C.blue
  if (p === '短中') return C.amber
  return C.teal
}

/**
 * Single Holding Row — 溫暖極簡三行佈局
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

  return h(
    'div',
    { style: { marginBottom: expanded ? 0 : 10 } },

    h(
      'div',
      {
        style: {
          background: 'transparent',
          borderBottom: `1px solid ${alpha(C.textMute, '08')}`,
          borderRadius: expanded ? '8px 8px 0 0' : 0,
          padding: '12px 4px',
          transition: 'background 0.2s ease',
        },
      },

      // Row 1: Name + Code + Tags + Expand
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
          { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 } },
          h('span', {
            style: {
              fontSize: 13,
              fontWeight: 500,
              color: C.text,
              letterSpacing: '0.02em',
            },
          }, holding.name),
          h('span', {
            style: { fontSize: 10, color: C.textMute, fontWeight: 400 },
          }, holding.code),
          meta?.period && h(
            'span',
            {
              style: {
                fontSize: 9,
                fontWeight: 400,
                color: periodColor(meta.period),
                opacity: 0.7,
                letterSpacing: '0.04em',
              },
            },
            periodLabel(meta.period)
          ),
          meta?.position && h(
            'span',
            {
              style: {
                fontSize: 9,
                fontWeight: 400,
                color: C.textMute,
                letterSpacing: '0.04em',
              },
            },
            meta.position
          )
        ),
        h(
          'button',
          {
            onClick: onToggle,
            style: {
              background: 'transparent',
              border: 'none',
              color: C.textMute,
              cursor: 'pointer',
              fontSize: 10,
              padding: '4px 6px',
              opacity: 0.5,
              transition: 'opacity 0.2s',
            },
          },
          expanded ? '收起' : '展開'
        )
      ),

      // Row 2: Industry + Strategy
      meta && h(
        'div',
        {
          style: {
            fontSize: 10,
            color: C.textMute,
            marginBottom: 8,
            fontWeight: 400,
            letterSpacing: '0.04em',
          },
        },
        [meta.industry, meta.strategy].filter(Boolean).join(' · ')
      ),

      // Row 3: Financial data
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: 12,
              fontSize: 11,
              color: C.textMute,
              fontWeight: 400,
              letterSpacing: '0.02em',
            },
          },
          h('span', null, `${qty.toLocaleString()}股`),
          h('span', null, `${cost}`),
          h('span', { style: { color: C.textSec, fontWeight: 500 } }, holding.price),
          h('span', { className: 'tn', style: { fontSize: 10 } }, value.toLocaleString())
        ),
        // PnL — 純文字，無色條，無 pill
        h(
          'div',
          {
            className: 'tn',
            style: {
              fontSize: 12,
              fontWeight: 500,
              color: pc(pnl),
              letterSpacing: '0.02em',
              textAlign: 'right',
            },
          },
          h('span', null, `${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}`),
          h('span', {
            style: { fontSize: 10, fontWeight: 400, opacity: 0.7, marginLeft: 6 },
          }, `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`)
        )
      )
    ),

    // Expanded details — 柔和展開
    expanded &&
      h(
        'div',
        {
          style: {
            background: alpha(C.textMute, '03'),
            borderBottom: `1px solid ${alpha(C.textMute, '08')}`,
            borderRadius: '0 0 8px 8px',
            padding: '14px 8px',
            marginBottom: 10,
          },
        },
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
          h(
            'div',
            null,
            h('div', {
              style: { fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 },
            }, '目標價'),
            h('input', {
              type: 'number',
              value: holding.targetPrice || '',
              onChange: (e) =>
                onUpdateTarget(holding.code, e.target.value ? Number(e.target.value) : null),
              placeholder: '輸入目標價',
              style: {
                width: '100%',
                background: 'transparent',
                border: `1px solid ${alpha(C.textMute, '12')}`,
                borderRadius: 6,
                padding: '8px 10px',
                color: C.text,
                fontSize: 12,
                fontWeight: 400,
                outline: 'none',
                transition: 'border-color 0.2s',
              },
            }),
            holding.targetPrice && holding.price && h(
              'div',
              {
                style: {
                  fontSize: 9,
                  color: holding.price < holding.targetPrice ? C.up : C.down,
                  marginTop: 4,
                  fontWeight: 400,
                  opacity: 0.7,
                },
              },
              `距目標 ${(((holding.targetPrice - holding.price) / holding.price) * 100).toFixed(1)}%`
            )
          ),

          h(
            'div',
            null,
            h('div', {
              style: { fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 },
            }, '警報條件'),
            h('input', {
              type: 'text',
              value: holding.alert || '',
              onChange: (e) => onUpdateAlert(holding.code, e.target.value),
              placeholder: '如：跌破月線',
              style: {
                width: '100%',
                background: 'transparent',
                border: `1px solid ${alpha(C.textMute, '12')}`,
                borderRadius: 6,
                padding: '8px 10px',
                color: C.text,
                fontSize: 12,
                fontWeight: 400,
                outline: 'none',
                transition: 'border-color 0.2s',
              },
            })
          )
        ),

        holding.type &&
          h(
            'div',
            { style: { fontSize: 10, color: C.textMute, marginTop: 12, fontWeight: 400 } },
            '類型：',
            holding.type
          )
      )
  )
}

/**
 * Holdings Table — 溫暖日常風
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
          padding: '40px 16px',
          textAlign: 'center',
        },
      },
      h('div', {
        style: { fontSize: 13, color: C.textMute, fontWeight: 400, letterSpacing: '0.04em' },
      }, '尚無持股'),
      h(
        'div',
        { style: { fontSize: 10, color: C.textMute, marginTop: 6, opacity: 0.6 } },
        '上傳成交記錄或手動新增'
      )
    )
  }

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
    'div',
    null,
    h('div', { style: { ...sectionTitle, marginBottom: 14 } }, `持 股 明 細 · ${holdings.length} 檔`),
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
