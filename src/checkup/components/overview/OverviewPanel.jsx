import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Card, Button, MetricCard } from '../common'

const lbl = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}

const ghostBtn = {
  borderRadius: 20,
  padding: '4px 11px',
  fontSize: 9,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'all 0.18s ease',
}

const pc = (p) => (p == null ? C.textMute : p >= 0 ? C.up : C.down)

/**
 * Overview Header
 */
export function OverviewHeader({ portfolioCount, totalValue, totalPnl, onExit }) {
  return h(
    Card,
    {
      style: {
        marginBottom: 8,
        borderLeft: `3px solid ${alpha(C.blue, '40')}`,
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 10,
          flexWrap: 'wrap',
        },
      },
      h(
        'div',
        null,
        h('div', { style: { ...lbl, color: C.blue, marginBottom: 4 } }, '全部總覽'),
        h(
          'div',
          { style: { fontSize: 13, color: C.text, fontWeight: 600 } },
          '跨組合檢視目前持倉、重複部位與待處理事件'
        ),
        h(
          'div',
          { style: { fontSize: 10, color: C.textMute, marginTop: 4, lineHeight: 1.7 } },
          '這裡只做彙總，不會修改任何組合資料。'
        )
      ),
      h(
        Button,
        {
          onClick: onExit,
          style: {
            background: C.cardBlue,
            color: C.blue,
            border: `1px solid ${alpha(C.blue, '2a')}`,
            ...ghostBtn,
          },
        },
        '返回目前組合'
      )
    ),
    h(
      'div',
      {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10 },
      },
      h(MetricCard, {
        label: '組合數',
        value: portfolioCount,
        tone: 'muted',
      }),
      h(MetricCard, {
        label: '總市值',
        value: Math.round(totalValue).toLocaleString(),
        tone: 'blue',
      }),
      h(MetricCard, {
        label: '總損益',
        value: `${totalPnl >= 0 ? '+' : ''}${Math.round(totalPnl).toLocaleString()}`,
        tone: totalPnl >= 0 ? 'up' : 'down',
      })
    )
  )
}

/**
 * Portfolio Summary List
 */
export function PortfolioSummaryList({ portfolios, activePortfolioId, onSwitch }) {
  return h(
    Card,
    { style: { marginBottom: 8 } },
    h('div', { style: lbl }, '組合摘要'),
    h(
      'div',
      { style: { display: 'grid', gap: 8 } },
      portfolios.map((portfolio) => {
        const noteSummary = [
          portfolio.notes?.riskProfile,
          portfolio.notes?.preferences,
          portfolio.notes?.customNotes,
        ]
          .filter(Boolean)
          .join(' · ')

        return h(
          'div',
          {
            key: portfolio.id,
            style: {
              background: portfolio.id === activePortfolioId ? C.subtleElev : C.subtle,
              border: `1px solid ${portfolio.id === activePortfolioId ? C.borderStrong : C.border}`,
              borderRadius: 8,
              padding: '10px 12px',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 10,
                flexWrap: 'wrap',
              },
            },
            h(
              'div',
              null,
              h(
                'div',
                { style: { fontSize: 12, fontWeight: 600, color: C.text } },
                portfolio.name,
                portfolio.id === 'me' &&
                  h('span', { style: { fontSize: 9, color: C.textMute, marginLeft: 6 } }, 'owner')
              ),
              h(
                'div',
                { style: { fontSize: 10, color: C.textMute, marginTop: 4 } },
                `${portfolio.holdingCount} 檔 · 待處理事件 ${portfolio.pendingEvents} 件 · 報酬 ${portfolio.retPct >= 0 ? '+' : ''}${portfolio.retPct.toFixed(1)}%`
              ),
              noteSummary &&
                h(
                  'div',
                  { style: { fontSize: 10, color: C.textSec, marginTop: 6, lineHeight: 1.7 } },
                  noteSummary
                )
            ),
            h(
              'div',
              { style: { textAlign: 'right' } },
              h(
                'div',
                {
                  className: 'tn',
                  style: { fontSize: 16, fontWeight: 700, color: pc(portfolio.totalPnl) },
                },
                portfolio.totalPnl >= 0 ? '+' : '' + Math.round(portfolio.totalPnl).toLocaleString()
              ),
              h(
                Button,
                {
                  onClick: () => onSwitch(portfolio.id),
                  style: {
                    marginTop: 6,
                    background: C.cardBlue,
                    color: C.blue,
                    border: `1px solid ${alpha(C.blue, '2a')}`,
                    ...ghostBtn,
                  },
                },
                '打開這組'
              )
            )
          )
        )
      })
    )
  )
}

/**
 * Duplicate Holdings Display
 */
export function DuplicateHoldings({ holdings }) {
  if (!holdings || holdings.length === 0) {
    return h(
      Card,
      { style: { marginBottom: 8 } },
      h('div', { style: lbl }, '重複持股'),
      h('div', { style: { fontSize: 11, color: C.textMute } }, '目前沒有跨組合重複持有同一檔股票。')
    )
  }

  return h(
    Card,
    { style: { marginBottom: 8 } },
    h('div', { style: lbl }, '重複持股'),
    h(
      'div',
      { style: { display: 'grid', gap: 8 } },
      holdings.map((item) =>
        h(
          'div',
          {
            key: item.code,
            style: { paddingBottom: 8, borderBottom: `1px solid ${C.borderSub}` },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              },
            },
            h(
              'div',
              null,
              h('span', { style: { fontSize: 12, color: C.text, fontWeight: 600 } }, item.name),
              h('span', { style: { fontSize: 10, color: C.textMute, marginLeft: 6 } }, item.code)
            ),
            h(
              'span',
              {
                className: 'tn',
                style: { fontSize: 10, color: C.textSec },
              },
              `合計市值 ${Math.round(item.totalValue).toLocaleString()}`
            )
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
            item.portfolios.map((portfolio) =>
              h(
                'span',
                {
                  key: `${item.code}-${portfolio.id}`,
                  style: {
                    fontSize: 9,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: C.subtle,
                    border: `1px solid ${C.border}`,
                    color: C.textSec,
                  },
                },
                `${portfolio.name} · ${portfolio.qty}股 · ${portfolio.pnl >= 0 ? '+' : ''}${Math.round(portfolio.pnl)}`
              )
            )
          )
        )
      )
    )
  )
}

/**
 * Pending Items Display
 */
export function PendingItems({ items, onSwitch }) {
  if (!items || items.length === 0) {
    return h(
      Card,
      { style: { marginBottom: 8 } },
      h('div', { style: lbl }, '待處理事項'),
      h('div', { style: { fontSize: 11, color: C.textMute } }, '目前所有組合都沒有待處理事件。')
    )
  }

  return h(
    Card,
    { style: { marginBottom: 8 } },
    h('div', { style: lbl }, '待處理事項'),
    h(
      'div',
      { style: { display: 'grid', gap: 8 } },
      items.slice(0, 16).map((item) =>
        h(
          'div',
          {
            key: `${item.portfolioId}-${item.id}`,
            style: {
              background: C.subtle,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '10px 12px',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 8,
                flexWrap: 'wrap',
              },
            },
            h(
              'div',
              null,
              h('div', { style: { fontSize: 11, color: C.text, fontWeight: 600 } }, item.title),
              h(
                'div',
                { style: { fontSize: 10, color: C.textMute, marginTop: 4 } },
                `${item.portfolioName} · ${item.date || '未排日期'} · 預測${item.pred === 'up' ? '看漲' : item.pred === 'down' ? '看跌' : '中性'}`
              ),
              item.predReason &&
                h(
                  'div',
                  { style: { fontSize: 10, color: C.textSec, marginTop: 6, lineHeight: 1.7 } },
                  item.predReason
                )
            ),
            h(
              Button,
              {
                onClick: () => onSwitch(item.portfolioId),
                style: {
                  background: C.cardBlue,
                  color: C.blue,
                  border: `1px solid ${alpha(C.blue, '2a')}`,
                  ...ghostBtn,
                },
              },
              '去處理'
            )
          )
        )
      )
    )
  )
}

/**
 * Main Overview Panel
 */
export function OverviewPanel({
  portfolioCount,
  totalValue,
  totalPnl,
  portfolios,
  activePortfolioId,
  duplicateHoldings,
  pendingItems,
  onExit,
  onSwitch,
}) {
  return h(
    'div',
    null,
    h(OverviewHeader, {
      portfolioCount,
      totalValue,
      totalPnl,
      onExit,
    }),
    h(PortfolioSummaryList, {
      portfolios,
      activePortfolioId,
      onSwitch,
    }),
    h(DuplicateHoldings, { holdings: duplicateHoldings }),
    h(PendingItems, { items: pendingItems, onSwitch })
  )
}
