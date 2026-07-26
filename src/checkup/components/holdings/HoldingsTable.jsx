import { createElement as h, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { C, alpha } from '../../theme.js'
import { STOCK_META } from '../../seedData.js'
import {
  getHoldingMarketValue,
  getHoldingReturnPct,
  getHoldingUnrealizedPnl,
} from '../../lib/holdings.js'
// @analytics-required: checkup_holding_target_update, checkup_holding_alert_update
import { track } from '@/lib/analytics/events'
// M1 → M2 主動跳轉：走 Shell event bus，禁止 deep import M2。
import { useEmitClosingOpenStock } from '../../modules/holdings/useEmitClosingOpenStock'

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
 * Single Holding Card — 直向閱讀卡片
 * 結構：名稱(上) → 報酬率(主視覺) → 標籤 → 補充資訊(下)
 */
function HoldingRowImpl({
  holding,
  expanded = false,
  onToggle = () => {},
  onUpdateTarget = () => {},
  onUpdateAlert = () => {},
}) {
  const handleToggle = useCallback(() => onToggle(holding.code), [onToggle, holding.code])
  const handleUpdateTarget = useCallback(
    (e) => {
      onUpdateTarget(holding.code, e.target.value ? Number(e.target.value) : null)
      try { track('checkup_holding_target_update', { code: holding.code, source: 'table' }) } catch {}
    },
    [onUpdateTarget, holding.code]
  )
  const handleUpdateAlert = useCallback(
    (e) => {
      onUpdateAlert(holding.code, e.target.value)
      try { track('checkup_holding_alert_update', { code: holding.code, source: 'table' }) } catch {}
    },
    [onUpdateAlert, holding.code]
  )
  const pnl = getHoldingUnrealizedPnl(holding)
  const pct = getHoldingReturnPct(holding)
  const value = getHoldingMarketValue(holding)
  const meta = STOCK_META[holding.code]
  const qty = Number(holding.qty) || 0
  const cost = Number(holding.cost) || 0
  const pnlColor = pc(pnl)

  const tagStyle = {
    fontSize: 10,
    fontWeight: 400,
    color: C.textMute,
    letterSpacing: '0.06em',
    padding: '2px 8px',
    border: `1px solid ${alpha(C.textMute, '12')}`,
    borderRadius: 999,
    lineHeight: 1.4,
  }

  return h(
    'div',
    { style: { marginBottom: 14 } },

    h(
      'div',
      {
        style: {
          background: 'transparent',
          border: `1px solid ${alpha(C.textMute, '10')}`,
          borderRadius: 8,
          padding: '20px 18px 18px',
          transition: 'border-color 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        },
      },

      // ── 區塊 1：名稱 + 代號 + 展開按鈕（標頭）
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8, flex: 1, minWidth: 0 } },
          h('span', {
            style: {
              fontSize: 15,
              fontWeight: 500,
              color: C.text,
              letterSpacing: '0.02em',
            },
          }, holding.name),
          h('span', {
            style: {
              fontSize: 11,
              color: C.textMute,
              fontWeight: 400,
              opacity: 0.7,
              letterSpacing: '0.04em',
            },
          }, holding.code)
        ),
        h(
          'button',
          {
            onClick: handleToggle,
            style: {
              background: 'transparent',
              border: 'none',
              color: C.textMute,
              cursor: 'pointer',
              fontSize: 10,
              padding: '4px 6px',
              opacity: 0.5,
              transition: 'opacity 0.2s',
              letterSpacing: '0.08em',
            },
          },
          expanded ? '收起' : '展開'
        )
      ),

      // ── 區塊 2：報酬率（主視覺焦點，特大字）
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            paddingTop: 2,
            paddingBottom: 4,
          },
        },
        h(
          'span',
          {
            className: 'tn',
            style: {
              fontSize: 22,
              fontWeight: 500,
              color: pnlColor,
              letterSpacing: '-0.01em',
              lineHeight: 1,
            },
          },
          `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
        ),
        h(
          'span',
          {
            className: 'tn',
            style: {
              fontSize: 12,
              fontWeight: 400,
              color: pnlColor,
              opacity: 0.75,
              letterSpacing: '0.02em',
            },
          },
          `${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}`
        )
      ),

      // ── 區塊 3：標籤群組（產業 / 策略 / 週期 / 部位）
      (meta?.industry || meta?.strategy || meta?.period || meta?.position) && h(
        'div',
        {
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          },
        },
        meta?.industry && h('span', { style: tagStyle }, meta.industry),
        meta?.strategy && h('span', { style: tagStyle }, meta.strategy),
        meta?.period && h(
          'span',
          { style: { ...tagStyle, color: alpha(periodColor(meta.period), 'cc'), borderColor: alpha(periodColor(meta.period), '30') } },
          periodLabel(meta.period)
        ),
        meta?.position && h('span', { style: tagStyle }, meta.position)
      ),

      // ── 區塊 4：補充資訊（持股 / 成本 / 現價 / 市值）
      h(
        'div',
        {
          className: 'rwd-4col',
          style: {
            gap: 10,
            paddingTop: 12,
            borderTop: `1px solid ${alpha(C.textMute, '08')}`,
          },
        },
        [
          { label: '股數', value: qty.toLocaleString() },
          { label: '成本', value: cost.toString() },
          { label: '現價', value: holding.price ?? '—' },
          { label: '市值', value: value ? value.toLocaleString() : '—' },
        ].map((item, idx) => h(
          'div',
          { key: idx, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('span', {
            style: {
              fontSize: 9,
              color: C.textMute,
              fontWeight: 400,
              letterSpacing: '0.1em',
              opacity: 0.7,
            },
          }, item.label),
          h('span', {
            className: 'tn',
            style: {
              fontSize: 12,
              color: C.textSec,
              fontWeight: 400,
              letterSpacing: '0.02em',
            },
          }, item.value)
        ))
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
              value: holding.targetPrice ?? '',
              onChange: handleUpdateTarget,
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
            holding.targetPrice != null && holding.price != null && Number(holding.price) > 0 && h(
              'div',
              {
                style: {
                  fontSize: 9,
                  color: Number(holding.price) < Number(holding.targetPrice) ? C.up : C.down,
                  marginTop: 4,
                  fontWeight: 400,
                  opacity: 0.7,
                },
              },
              `距目標 ${(((Number(holding.targetPrice) - Number(holding.price)) / Number(holding.price)) * 100).toFixed(1)}%`
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
              onChange: handleUpdateAlert,
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

export const HoldingRow = memo(HoldingRowImpl, (prev, next) =>
  prev.holding === next.holding &&
  prev.expanded === next.expanded &&
  prev.onToggle === next.onToggle &&
  prev.onUpdateTarget === next.onUpdateTarget &&
  prev.onUpdateAlert === next.onUpdateAlert
)

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

  // Bug B4/B5 fix：sort memoize + NaN 穩定化（NaN 全丟到序尾，避免 <, > 都 false 導致亂序）。
  const sorted = useMemo(() => {
    const isNumeric = sortBy === 'value' || sortBy === 'pnl' || sortBy === 'pct'
    const NAN_SENTINEL = sortDir === 'asc' ? Infinity : -Infinity
    const getVal = (x) => {
      switch (sortBy) {
        case 'value': return getHoldingMarketValue(x)
        case 'pnl':   return getHoldingUnrealizedPnl(x)
        case 'pct':   return getHoldingReturnPct(x)
        case 'code':
        default:      return x.code
      }
    }
    return [...holdings].sort((a, b) => {
      let aVal = getVal(a)
      let bVal = getVal(b)
      if (isNumeric) {
        aVal = Number.isFinite(aVal) ? aVal : NAN_SENTINEL
        bVal = Number.isFinite(bVal) ? bVal : NAN_SENTINEL
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      // string 分支
      const sa = String(aVal ?? '')
      const sb = String(bVal ?? '')
      const cmp = sa < sb ? -1 : sa > sb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [holdings, sortBy, sortDir])

  // stable toggle callback so memo'd HoldingRow doesn't re-render on every parent render
  const expandedStockRef = useRef(expandedStock)
  const setExpandedStockRef = useRef(setExpandedStock)
  useEffect(() => { expandedStockRef.current = expandedStock }, [expandedStock])
  useEffect(() => { setExpandedStockRef.current = setExpandedStock }, [setExpandedStock])
  const handleToggle = useCallback((code) => {
    setExpandedStockRef.current(expandedStockRef.current === code ? null : code)
  }, [])

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
          onToggle: handleToggle,
          onUpdateTarget,
          onUpdateAlert,
        })
      )
    )
  )
}
