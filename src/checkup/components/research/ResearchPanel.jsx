import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Card, Button } from '../common'
import Md from '../Md.jsx'

const lbl = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}

/**
 * Research Panel Header
 */
export function ResearchHeader({
  onEvolve,
  onRefresh,
  researching,
  reportRefreshing,
  reportRefreshStatus,
}) {
  return h(
    Card,
    {
      style: { marginBottom: 10, borderLeft: `3px solid ${alpha(C.teal, '40')}` },
    },
    h('div', { style: { ...lbl, color: C.teal, marginBottom: 6 } }, 'AutoResearch · 自主進化系統'),
    h(
      'div',
      { style: { fontSize: 11, color: C.textSec, lineHeight: 1.7, marginBottom: 10 } },
      '借鑒 Karpathy autoresearch：AI 不只研究個股，更能審視你的整個投資系統 — ',
      '決策品質、認知盲點、情緒模式、策略一致性 — 並自動進化策略大腦。'
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 6, marginBottom: 10 } },
      h(
        Button,
        {
          onClick: onEvolve,
          disabled: researching,
          style: {
            flex: 1,
            padding: '13px',
            borderRadius: 8,
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: researching ? 'not-allowed' : 'pointer',
            background: researching
              ? C.subtle
              : `linear-gradient(135deg,${C.fillTomato},${C.fillChoco})`,
            color: researching ? C.textMute : C.onFill,
          },
        },
        researching ? '全組合研究 + 系統進化中...' : '🧬 全組合研究 + 系統進化'
      ),
      h(
        Button,
        {
          onClick: onRefresh,
          disabled: reportRefreshing,
          style: {
            padding: '13px 14px',
            borderRadius: 8,
            border: `1px solid ${alpha(C.amber, '2a')}`,
            fontSize: 12,
            fontWeight: 600,
            cursor: reportRefreshing ? 'not-allowed' : 'pointer',
            background: alpha(C.amber, '15'),
            color: reportRefreshing ? C.textMute : C.amber,
            whiteSpace: 'nowrap',
          },
        },
        reportRefreshing ? '刷新中...' : '刷新公開報告'
      )
    ),
    reportRefreshStatus &&
      h('div', { style: { fontSize: 10, color: C.textMute, marginBottom: 8 } }, reportRefreshStatus)
  )
}

/**
 * Stock Research Buttons
 */
export function StockResearchButtons({
  holdings,
  onResearch,
  researching,
  researchTarget,
  STOCK_META,
  IND_COLOR,
}) {
  return h(
    'div',
    null,
    h(
      'div',
      { style: { fontSize: 9, color: C.textMute, marginBottom: 4 } },
      '個股研究選擇（3 輪迭代）：'
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
      holdings.map((holding) => {
        const m = STOCK_META?.[holding.code]
        const color = m ? IND_COLOR?.[m.industry] || C.textMute : C.textMute
        const isTarget = researching && researchTarget === holding.code
        return h(
          Button,
          {
            key: holding.code,
            onClick: () => onResearch('single', holding),
            disabled: researching,
            style: {
              fontSize: 9,
              padding: '4px 8px',
              borderRadius: 6,
              cursor: researching ? 'not-allowed' : 'pointer',
              background: isTarget ? alpha(color, '20') : C.card,
              border: `1px solid ${isTarget ? color : C.border}`,
              color: isTarget ? color : C.textSec,
              whiteSpace: 'nowrap',
            },
          },
          isTarget ? '研究中...' : holding.name
        )
      })
    )
  )
}

/**
 * Data Refresh Center
 */
export function DataRefreshCenter({ dataRefreshRows, onResearch, researching, holdings }) {
  if (!dataRefreshRows || dataRefreshRows.length === 0) return null

  return h(
    Card,
    {
      style: { marginBottom: 10, borderLeft: `3px solid ${alpha(C.amber, '40')}` },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 8,
        },
      },
      h(
        'div',
        null,
        h('div', { style: { ...lbl, marginBottom: 4, color: C.amber } }, '資料更新中心'),
        h(
          'div',
          { style: { fontSize: 11, color: C.textSec, lineHeight: 1.7 } },
          '先補齊 stale / missing 的財報與目標價，AI 之後的分析會更扎實。'
        )
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        dataRefreshRows.slice(0, 4).map((item) =>
          h(
            'span',
            {
              key: item.code,
              style: {
                fontSize: 9,
                padding: '4px 8px',
                borderRadius: 999,
                background: C.subtle,
                border: `1px solid ${C.border}`,
                color: C.amber,
              },
            },
            `${item.name} 需更新`
          )
        )
      )
    ),
    h(
      'div',
      { style: { display: 'grid', gap: 7 } },
      dataRefreshRows.slice(0, 5).map((item) =>
        h(
          'div',
          {
            key: item.code,
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              background: C.subtle,
              border: `1px solid ${C.borderSub}`,
              borderRadius: 8,
              padding: '8px 10px',
            },
          },
          h(
            'div',
            null,
            h(
              'div',
              { style: { fontSize: 11, color: C.text, fontWeight: 500 } },
              `${item.name} (${item.code})`
            ),
            h(
              'div',
              { style: { fontSize: 9, color: C.textMute, marginTop: 3 } },
              `目標價：${item.targetStatus} · 財報：${item.fundamentalStatus}`
            )
          ),
          h(
            Button,
            {
              onClick: () =>
                onResearch(
                  'single',
                  holdings.find((h) => h.code === item.code)
                ),
              disabled: researching || !holdings.find((h) => h.code === item.code),
              style: {
                padding: '7px 10px',
                borderRadius: 7,
                border: `1px solid ${alpha(C.teal, '2a')}`,
                background: alpha(C.teal, '15'),
                color: C.teal,
                fontSize: 10,
                fontWeight: 500,
                cursor: researching ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              },
            },
            '先研究這檔'
          )
        )
      )
    )
  )
}

/**
 * Research Progress
 */
export function ResearchProgress({ researching, researchTarget, holdings }) {
  if (!researching) return null

  return h(
    Card,
    {
      style: { marginBottom: 10, textAlign: 'center', padding: '20px 14px' },
    },
    h(
      'div',
      {
        style: {
          fontSize: 12,
          color: researchTarget === 'EVOLVE' ? C.up : C.teal,
          fontWeight: 500,
          marginBottom: 6,
          animation: 'pulse 2s infinite',
        },
      },
      researchTarget === 'EVOLVE'
        ? 'AI 正在審視你的投資系統並自我進化...'
        : `AI 正在進行${researchTarget === 'PORTFOLIO' ? '全組合' : '個股'}深度研究...`
    ),
    h(
      'div',
      { style: { fontSize: 10, color: C.textMute } },
      researchTarget === 'EVOLVE'
        ? '3 輪迭代：系統診斷 → 進化建議 → 策略大腦更新，預計 1-2 分鐘'
        : researchTarget === 'PORTFOLIO'
          ? `逐一分析 ${holdings?.length || 0} 檔持股 + 組合策略，預計 1-2 分鐘`
          : '3 輪迭代研究：基本面 → 風險催化 → 策略建議，預計 30 秒'
    ),
    h(
      'div',
      {
        style: {
          marginTop: 10,
          height: 3,
          background: C.subtle,
          borderRadius: 2,
          overflow: 'hidden',
        },
      },
      h('div', {
        style: {
          height: '100%',
          background: C.teal,
          borderRadius: 2,
          animation: 'progress 15s ease-in-out infinite',
          width: '70%',
        },
      })
    )
  )
}

/**
 * Research Results
 */
export function ResearchResults({ results, onEnrich, enriching }) {
  if (!results) return null

  return h(
    'div',
    { style: { marginBottom: 10 } },
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        },
      },
      h(
        'div',
        { style: { ...lbl, marginBottom: 0, color: C.teal } },
        `${results.name} · ${results.date}`
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          },
        },
        results.priceAtResearch &&
          h(
            'span',
            { style: { fontSize: 10, color: C.textMute } },
            `研究時股價 ${results.priceAtResearch}`
          ),
        results.mode === 'single' &&
          h(
            Button,
            {
              onClick: () => onEnrich(results),
              disabled: enriching === results.code,
              style: {
                padding: '6px 9px',
                borderRadius: 7,
                border: `1px solid ${alpha(C.amber, '2a')}`,
                background: alpha(C.amber, '15'),
                color: C.amber,
                fontSize: 10,
                fontWeight: 500,
                cursor: enriching === results.code ? 'not-allowed' : 'pointer',
              },
            },
            enriching === results.code ? '同步中...' : '同步到 dossier'
          )
      )
    ),
    results.rounds?.map((round, i) =>
      h(
        Card,
        {
          key: i,
          style: {
            marginBottom: 6,
            borderLeft: `2px solid ${alpha([C.blue, C.amber, C.teal][i % 3], '40')}`,
          },
        },
        h(
          'div',
          {
            style: {
              fontSize: 10,
              fontWeight: 600,
              color: [C.blue, C.amber, C.teal][i % 3],
              marginBottom: 6,
            },
          },
          `Round ${i + 1}：${round.title}`
        ),
        h(Md, { text: round.content, color: C.textSec })
      )
    )
  )
}

/**
 * Research History
 */
export function ResearchHistory({ history, onSelect, selectedId }) {
  if (!history || history.length === 0) return null

  return h(
    Card,
    null,
    h(
      'div',
      { style: { ...lbl, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, '歷史研究記錄'),
      h(
        'span',
        { style: { fontSize: 9, color: C.textMute, fontWeight: 400 } },
        `${history.length} 筆`
      )
    ),
    history.map((r, i) =>
      h(
        'div',
        {
          key: r.timestamp || i,
          onClick: () => onSelect(r),
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 6px',
            cursor: 'pointer',
            borderRadius: 6,
            background: selectedId === r.timestamp ? C.subtle : 'transparent',
            borderBottom: `1px solid ${C.borderSub}`,
          },
        },
        h(
          'div',
          null,
          h(
            'span',
            { style: { fontSize: 12, color: r.mode === 'evolve' ? C.up : C.text } },
            `${r.mode === 'evolve' ? '🧬 ' : '🔬 '}${r.name}`
          ),
          h('span', { style: { fontSize: 10, color: C.textMute, marginLeft: 6 } }, r.date)
        ),
        h('span', { style: { fontSize: 9, color: C.textMute } }, `${r.rounds?.length || 0} 輪分析`)
      )
    )
  )
}

/**
 * Main Research Panel
 */
export function ResearchPanel({
  holdings,
  researching,
  researchTarget,
  reportRefreshing,
  reportRefreshStatus,
  dataRefreshRows,
  researchResults,
  researchHistory,
  enrichingResearchCode,
  STOCK_META,
  IND_COLOR,
  onEvolve,
  onRefresh,
  onResearch,
  onEnrich,
  onSelectHistory,
}) {
  return h(
    'div',
    null,
    h(ResearchHeader, {
      onEvolve,
      onRefresh,
      researching,
      reportRefreshing,
      reportRefreshStatus,
    }),
    h(StockResearchButtons, {
      holdings,
      onResearch,
      researching,
      researchTarget,
      STOCK_META,
      IND_COLOR,
    }),
    h(DataRefreshCenter, {
      dataRefreshRows,
      onResearch,
      researching,
      holdings,
    }),
    h(ResearchProgress, {
      researching,
      researchTarget,
      holdings,
    }),
    h(ResearchResults, {
      results: researchResults,
      onEnrich,
      enriching: enrichingResearchCode,
    }),
    !researchResults &&
      !researching &&
      (!researchHistory || researchHistory.length === 0) &&
      h(
        Card,
        {
          style: { textAlign: 'center', padding: '24px' },
        },
        h(
          'div',
          { style: { fontSize: 11, color: C.textMute, lineHeight: 1.8 } },
          '點擊上方按鈕開始第一次深度研究。',
          h('br'),
          'AI 將自主進行多輪迭代分析，像研究員一樣逐步深入。'
        )
      ),
    h(ResearchHistory, {
      history: researchHistory,
      onSelect: onSelectHistory,
      selectedId: researchResults?.timestamp,
    })
  )
}
