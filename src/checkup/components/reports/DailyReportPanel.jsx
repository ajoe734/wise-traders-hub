import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Card, Button, Badge } from '../common'
import Md from '../Md.jsx'
// M2 → M1 / M5 主動跳轉：一律走 Shell event bus，禁止直接 import 其他模組內部檔案。
import { useEmitHoldingsFocus } from '../../modules/closing/useEmitHoldingsFocus'
import { useEmitResearchPrefill } from '../../modules/closing/useEmitResearchPrefill'

const crossModuleBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: C.textMute,
  cursor: 'pointer',
  fontSize: 10,
  padding: '2px 4px',
  letterSpacing: '0.06em',
}

const lbl = {
  fontSize: 10,
  color: C.textSec,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}

const titleLbl = {
  ...lbl,
  color: C.text,
  fontWeight: 700,
  letterSpacing: '0.03em',
}

const sectionTitle = (color = C.text) => ({
  ...titleLbl,
  color,
})

const stockNameStyle = { fontSize: 12, fontWeight: 700, color: C.text }
const stockCodeStyle = { fontSize: 10, color: C.textSec, fontWeight: 600, marginLeft: 6 }
const secondaryValueStyle = { color: C.textSec, fontWeight: 600 }

// 收盤分析個股顏色憲法（局部加強對比，2026-06-17）：
//   - 漲：保持品牌橘 C.up（#FF4D1F，已最強對比）
//   - 跌：採深炭灰 #3A352F（取代 C.down 的 #8B8680 — 在 #F5F3EF 背景上對比過低）
//   - 持平：C.textSec
// 僅在本檔（DailyReportPanel）覆寫，不動 holdings 單色橘紅憲法。
const PNL_DOWN_STRONG = '#3A352F'
const pc = (p) => (p == null ? C.textSec : p >= 0 ? C.up : PNL_DOWN_STRONG)

// 個股漲跌膠囊：把 % 與當日損益用底色膠囊呈現，提升辨識度
const pillStyle = (p, { size = 12 } = {}) => {
  const positive = p != null && p >= 0
  const negative = p != null && p < 0
  return {
    fontSize: size,
    fontWeight: 700,
    color: positive ? C.up : negative ? PNL_DOWN_STRONG : C.textSec,
    background: positive ? C.upBg : negative ? 'rgba(58,53,47,0.08)' : 'transparent',
    padding: '2px 7px',
    borderRadius: 5,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.01em',
    display: 'inline-block',
    minWidth: 56,
    textAlign: 'right',
  }
}

/**
 * Empty state for daily analysis
 */
export function DailyAnalysisEmpty({ onAnalyze, onStressTest, analyzing, stressTesting }) {
  return h(
    Card,
    {
      style: { textAlign: 'center', padding: '20px 14px', marginBottom: 10 },
    },
    h('div', { style: { fontSize: 24, marginBottom: 6, opacity: 0.4 } }, '◎'),
    h(
      'div',
      { style: { fontSize: 13, color: C.text, fontWeight: 700, marginBottom: 4 } },
      '每日收盤分析'
    ),
    h(
      'div',
      { style: { fontSize: 11, color: C.textSec, fontWeight: 600, marginBottom: 12, lineHeight: 1.6 } },
      '分析今日股價變動與事件連動性 · 自動比對持倉漲跌、異常波動、策略建議'
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      h(
        Button,
        {
          onClick: onAnalyze,
          style: {
            padding: '10px 24px',
            borderRadius: 8,
            border: `1px solid ${alpha(C.blue, '30')}`,
            background: alpha(C.blue, '08'),
            color: C.blue,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.03em',
          },
        },
        '開始今日收盤分析'
      ),
      h(
        Button,
        {
          onClick: onStressTest,
          disabled: stressTesting || analyzing,
          style: {
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${alpha(C.down, 0.4)}`,
            background: 'transparent',
            color: C.down,
            fontSize: 11,
            fontWeight: 600,
            cursor: stressTesting ? 'not-allowed' : 'pointer',
            letterSpacing: '0.03em',
            opacity: stressTesting ? 0.5 : 1,
          },
        },
        stressTesting ? '測試中...' : '⚠️ 風險壓力測試'
      )
    )
  )
}

/**
 * Analyzing state
 */
export function AnalyzingState({ step }) {
  return h(
    Card,
    {
      style: { textAlign: 'center', padding: '36px 16px' },
    },
    h(
      'div',
      {
        style: {
          fontSize: 13,
          color: C.amber,
          fontWeight: 500,
          animation: 'pulse 1.5s ease-in-out infinite',
        },
      },
      step || '正在分析今日收盤數據...'
    ),
    h(
      'div',
      { style: { fontSize: 11, color: C.textSec, fontWeight: 600, marginTop: 8 } },
      '取得股價 → 比對事件 → AI 策略分析 → 大腦進化'
    ),
    h(
      'div',
      {
        style: {
          width: '100%',
          height: 3,
          background: C.borderSub,
          borderRadius: 2,
          marginTop: 12,
          overflow: 'hidden',
        },
      },
      h('div', {
        style: {
          height: '100%',
          background: C.amber,
          borderRadius: 2,
          animation: 'progress 8s ease-in-out infinite',
          width: '70%',
        },
      })
    )
  )
}

/**
 * Stress test result
 */
export function StressResult({ result, onClose }) {
  if (!result) return null

  return h(
    Card,
    {
      style: {
        marginBottom: 8,
        borderLeft: `3px solid ${alpha(C.down, '40')}`,
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          cursor: 'pointer',
        },
        onClick: onClose,
      },
      h(
        'div',
        { style: { fontSize: 13, fontWeight: 600, color: C.down } },
        `⚠️ 風險壓力測試 · ${result.date}`
      ),
      h('span', { style: { fontSize: 11, color: C.textSec, fontWeight: 600 } }, '點擊關閉')
    ),
    h(
      'div',
      {
        style: { fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.8 },
      },
      result.text
    )
  )
}

/**
 * Daily Report Summary Card
 */
export function DailyReportSummary({ report, expanded, onToggle }) {
  return h(
    Card,
    {
      style: {
        marginBottom: 8,
        borderLeft: `3px solid ${alpha(report.totalTodayPnl >= 0 ? C.up : C.down, '40')}`,
        cursor: 'pointer',
      },
      onClick: onToggle,
    },
    h(
      'div',
      {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('div', { style: { ...titleLbl, marginBottom: 0 } }, `${report.date} 收盤分析`),
        h('span', { style: { fontSize: 10, color: C.textSec, fontWeight: 600 } }, report.time),
        !expanded &&
          report.anomalies?.length > 0 &&
          h(Badge, { color: 'amber' }, `異常 ${report.anomalies.length}`),
        !expanded &&
          report.needsReview?.length > 0 &&
          h(Badge, { color: 'up' }, `復盤 ${report.needsReview.length}`)
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h(
          'div',
          {
            style: {
              fontSize: 18,
              fontWeight: 700,
              color: pc(report.totalTodayPnl),
              lineHeight: 1.1,
            },
          },
          `${report.totalTodayPnl >= 0 ? '+' : ''}${report.totalTodayPnl.toLocaleString()}`
        ),
        h('span', { style: { fontSize: 9, color: C.textMute } }, expanded ? '▲' : '▼')
      )
    )
  )
}

/**
 * Holdings Changes Table
 */
export function HoldingsChanges({ changes }) {
  const emitHoldingsFocus = useEmitHoldingsFocus()
  const emitResearchPrefill = useEmitResearchPrefill()
  return h(
    Card,
    { style: { marginBottom: 8 } },
    h('div', { style: titleLbl }, '持倉今日漲跌'),
    changes.map((c, i) =>
      h(
        'div',
        {
          key: c.code,
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '5px 0',
            borderBottom: i < changes.length - 1 ? `1px solid ${C.borderSub}` : 'none',
          },
        },
        h(
          'div',
          null,
          h('span', { style: stockNameStyle }, c.name),
          h('span', { style: stockCodeStyle }, c.code),
          c.type !== '股票' &&
            h(
              'span',
              {
                style: {
                  fontSize: 9,
                  marginLeft: 5,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: C.amberBg,
                  color: C.amber,
                },
              },
              c.type
            )
        ),
        h(
          'div',
          {
            style: { textAlign: 'right', display: 'flex', gap: 12, alignItems: 'center' },
          },
          h('span', { style: { fontSize: 11, ...secondaryValueStyle } }, c.price?.toLocaleString()),
          h(
            'span',
            { style: pillStyle(c.changePct, { size: 12 }) },
            `${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(2)}%`
          ),
          h(
            'span',
            {
              style: {
                fontSize: 10,
                fontWeight: 600,
                color: c.todayPnl == null ? C.textMute : c.todayPnl >= 0 ? C.up : PNL_DOWN_STRONG,
                minWidth: 50,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              },
            },
            `${c.todayPnl >= 0 ? '+' : ''}${c.todayPnl.toLocaleString()}`
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: (e) => {
                e.stopPropagation()
                emitHoldingsFocus(c.code)
              },
              'data-testid': `closing-focus-holding-${c.code}`,
              title: '在持倉中檢視',
              style: crossModuleBtnStyle,
            },
            '→ 持倉',
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: (e) => {
                e.stopPropagation()
                emitResearchPrefill(c.code, '收盤分析')
              },
              'data-testid': `closing-research-${c.code}`,
              title: '帶入研究工作台',
              style: crossModuleBtnStyle,
            },
            '→ 研究',
          )
        )
      )
    )
  )
}

/**
 * Anomalies Section
 */
export function AnomaliesSection({ anomalies }) {
  if (!anomalies || anomalies.length === 0) return null

  return h(
    Card,
    {
      style: { marginBottom: 8, borderLeft: `3px solid ${alpha(C.amber, '40')}` },
    },
    h('div', { style: sectionTitle(C.amber) }, `異常波動 (>3%)`),
    anomalies.map((a) =>
      h(
        'div',
        {
          key: a.code,
          style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0' },
        },
        h('span', { style: stockNameStyle }, a.name),
        h(
          'span',
          { style: pillStyle(a.changePct, { size: 12 }) },
          `${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(2)}%`
        )
      )
    )
  )
}

/**
 * Event Correlations Section
 */
export function EventCorrelations({ correlations }) {
  if (!correlations || correlations.length === 0) return null

  return h(
    Card,
    {
      style: { marginBottom: 8, borderLeft: `3px solid ${alpha(C.teal, '40')}` },
    },
    h('div', { style: sectionTitle(C.teal) }, '事件連動分析'),
    correlations.map((ec) =>
      h(
        'div',
        {
          key: ec.id,
          style: { marginBottom: 10, background: C.subtle, borderRadius: 7, padding: '9px 11px' },
        },
        h(
          'div',
          { style: { fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 4 } },
          ec.title
        ),
        h('div', { style: { fontSize: 10, color: C.textMute, marginBottom: 6 } }, ec.date),
        ec.relatedStocks.map((s) =>
          h(
            'div',
            {
              key: s.code,
              style: { display: 'flex', justifyContent: 'space-between', padding: '3px 0' },
            },
            h('span', { style: { fontSize: 11, color: C.text, fontWeight: 700 } }, s.name),
            h(
              'span',
              { style: pillStyle(s.changePct, { size: 10 }) },
              `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`
            )
          )
        )
      )
    )
  )
}

/**
 * AI Event Assessments Section
 */
export function EventAssessments({
  assessments,
  newsEvents,
  onNavigate,
  onNavigateExpand = () => {},
}) {
  if (!assessments || assessments.length === 0) return null

  return h(
    Card,
    {
      style: { marginBottom: 8, borderLeft: `3px solid ${alpha(C.blue, '40')}` },
    },
    h('div', { style: sectionTitle(C.blue) }, `AI 事件評估 · ${assessments.length}件`),
    assessments.map((ea, i) => {
      const impactColor =
        ea.todayImpact === 'positive' ? C.up : ea.todayImpact === 'negative' ? C.down : C.textMute
      const impactLabel =
        ea.todayImpact === 'positive'
          ? '正面'
          : ea.todayImpact === 'negative'
            ? '負面'
            : ea.todayImpact === 'neutral'
              ? '中性'
              : '無關'

      return h(
        'div',
        {
          key: ea.eventId || i,
          style: { marginBottom: 8, background: C.subtle, borderRadius: 7, padding: '9px 11px' },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            },
          },
          h('span', { style: { fontSize: 11, fontWeight: 700, color: C.text } }, ea.title),
          h(
            'div',
            { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h(
              'span',
              {
                style: {
                  fontSize: 9,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: impactColor + '22',
                  color: impactColor,
                  fontWeight: 600,
                },
              },
              impactLabel
            ),
            ea.suggestClose &&
              h(
                'span',
                {
                  style: {
                    fontSize: 9,
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: C.amberBg,
                    color: C.amber,
                    fontWeight: 600,
                  },
                },
                '建議結案'
              )
          )
        ),
        h('div', { style: { fontSize: 10, color: C.text, marginBottom: 2, lineHeight: 1.6 } }, ea.note),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(
            'span',
              { style: { fontSize: 9, color: C.textSec, fontWeight: 600 } },
            `信心度 ${Math.round((ea.confidence || 0) * 100)}%`
          ),
          ea.suggestClose &&
            ea.suggestCloseReason &&
            h(
              'span',
              {
                style: { fontSize: 9, color: C.amber },
              },
              ea.suggestCloseReason
            )
        ),
        ea.suggestClose &&
          h(
            Button,
            {
              onClick: (ev) => {
                ev.stopPropagation()
                const NE_ = newsEvents || []
                const matched =
                  NE_.find((e2) => String(e2.id) === String(ea.eventId)) ||
                  NE_.find((e2) => e2.title === ea.title)
                onNavigate('news')
                if (matched) onNavigateExpand(matched.id)
              },
              style: {
                marginTop: 4,
                padding: '4px 10px',
                borderRadius: 5,
                border: `1px solid ${alpha(C.olive, '2a')}`,
                background: 'transparent',
                color: C.olive,
                fontSize: 10,
                cursor: 'pointer',
              },
            },
            '前往結案'
          )
      )
    })
  )
}

/**
 * Brain Audit Section
 */
export function BrainAuditSection({ brainAudit }) {
  const sections = [
    { key: 'validatedRules', label: '今天仍成立', color: C.up },
    { key: 'staleRules', label: '待更新 / 證據不足', color: C.amber },
    { key: 'invalidatedRules', label: '今天被證偽', color: C.down },
  ]

  const hasContent = sections.some((s) => (brainAudit?.[s.key] || []).length > 0)
  if (!hasContent) return null

  return h(
    Card,
    {
      style: { marginBottom: 8, borderLeft: `3px solid ${alpha(C.lavender, '40')}` },
    },
    h('div', { style: titleLbl }, 'AI 規則驗證'),
    sections.map((section) => {
      const rows = brainAudit?.[section.key] || []
      if (rows.length === 0) return null

      return h(
        'div',
        { key: section.key, style: { marginBottom: 8 } },
        h(
          'div',
          {
            style: { fontSize: 10, color: section.color, fontWeight: 600, marginBottom: 4 },
          },
          `${section.label} · ${rows.length} 條`
        ),
        rows.map((item, idx) =>
          h(
            'div',
            {
              key: `${section.key}-${idx}`,
              style: {
                marginBottom: 6,
                background: C.subtle,
                borderRadius: 7,
                padding: '9px 11px',
              },
            },
            h(
              'div',
              {
                style: { fontSize: 10, fontWeight: 700, color: C.text, marginBottom: 3 },
              },
              item.text || item.id || '未命名規則'
            ),
            item.reason &&
              h('div', { style: { fontSize: 10, color: C.textSec, fontWeight: 600, marginBottom: 2 } }, item.reason),
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
              item.confidence != null &&
                h(
                  'span',
                  { style: { fontSize: 9, color: C.textSec, fontWeight: 600 } },
                  `信心度 ${item.confidence}%`
                ),
              item.lastValidatedAt &&
                h(
                  'span',
                  { style: { fontSize: 9, color: C.textSec, fontWeight: 600 } },
                  `最近驗證 ${item.lastValidatedAt}`
                ),
              item.staleness &&
                h('span', { style: { fontSize: 9, color: C.textSec, fontWeight: 600 } }, `狀態 ${item.staleness}`),
              item.nextStatus &&
                h(
                  'span',
                  { style: { fontSize: 9, color: C.textSec, fontWeight: 600 } },
                  `建議轉為 ${item.nextStatus}`
                )
            ),
            (item.evidenceRefs || []).length > 0 &&
              h(
                'div',
                {
                  style: { fontSize: 9, color: C.blue, marginTop: 3 },
                },
                `證據來源：${item.evidenceRefs
                  .slice(0, 3)
                  .map((ref) => ref.label)
                  .join('、')}${item.evidenceRefs.length > 3 ? '…' : ''}`
              )
          )
        )
      )
    })
  )
}

/**
 * Needs Review Section
 */
export function NeedsReviewSection({ needsReview, onNavigate, onExpand }) {
  if (!needsReview || needsReview.length === 0) return null

  return h(
    Card,
    {
      style: { marginBottom: 8, borderLeft: `3px solid ${alpha(C.up, '40')}` },
    },
    h('div', { style: sectionTitle(C.up) }, `需要復盤 · ${needsReview.length}件`),
    needsReview.map((e) =>
      h(
        'div',
        { key: e.id, style: { marginBottom: 8 } },
        h('div', { style: { fontSize: 11, fontWeight: 700, color: C.text } }, e.title),
        h(
          'div',
          { style: { fontSize: 10, color: C.textSec, fontWeight: 600 } },
          `${e.date} — 預測${e.pred === 'up' ? '看漲' : '看跌'}`
        ),
        h(
          Button,
          {
            onClick: (ev) => {
              ev.stopPropagation()
              onNavigate('news')
              onExpand(e.id)
            },
            style: {
              marginTop: 4,
              padding: '4px 10px',
              borderRadius: 5,
              border: `1px solid ${alpha(C.olive, '2a')}`,
              background: 'transparent',
              color: C.olive,
              fontSize: 10,
              cursor: 'pointer',
            },
          },
          '前往復盤'
        )
      )
    )
  )
}

/**
 * AI Insight Section
 */
export function AIInsightSection({ insight, error, date, time }) {
  if (!insight && !error) return null

  if (insight) {
    return h(
      Card,
      {
        style: { marginBottom: 8, borderLeft: `3px solid ${alpha(C.lavender, '40')}` },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          },
        },
        h('div', { style: { ...sectionTitle(C.lavender), marginBottom: 0 } }, 'AI 策略分析'),
        h(
          'span',
          {
            style: {
              fontSize: 10,
              color: C.textMute,
              background: C.subtle,
              padding: '2px 8px',
              borderRadius: 4,
            },
          },
          `${date} ${time}`
        )
      ),
      h(Md, { text: insight, color: C.text })
    )
  }

  return h(
    Card,
    {
      style: { marginBottom: 10, background: C.subtle },
    },
    h(
      'div',
      {
        style: { fontSize: 11, color: C.textMute, textAlign: 'center', padding: '8px 0' },
      },
      'AI 分析未產生',
      error ? `：${error}` : '：請確認本地 AI API 金鑰與後端設定'
    )
  )
}

/**
 * Morning Note Section — auto-assembled daily trading memo
 */
export function MorningNoteSection({ morningNote }) {
  if (!morningNote) return null
  const { sections } = morningNote

  const hasContent =
    (sections.todayEvents?.length > 0) ||
    (sections.holdingStatus?.length > 0) ||
    (sections.announcements?.length > 0)

  if (!hasContent) return null

  return h(
    Card,
    {
      style: { marginBottom: 10, borderLeft: `3px solid ${alpha(C.teal, '40')}` },
    },
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
      h('div', { style: { ...lbl, color: C.teal, marginBottom: 0 } }, `每日交易備忘 — ${morningNote.date}`),
    ),

    // Today events
    sections.todayEvents?.length > 0 &&
      h(
        'div',
        { style: { marginBottom: 8 } },
        h('div', { style: { fontSize: 10, color: C.textSec, fontWeight: 600, marginBottom: 4 } }, '今日事件'),
        sections.todayEvents.map((e, i) =>
          h(
            'div',
            { key: i, style: { fontSize: 11, color: C.text, padding: '3px 0', display: 'flex', gap: 6, alignItems: 'center' } },
            e.impactLabel &&
              h('span', {
                style: {
                  fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                  background: e.impactLabel === 'HIGH' ? alpha(C.down, '22') : e.impactLabel === 'MEDIUM' ? C.amberBg : alpha(C.textMute, '15'),
                  color: e.impactLabel === 'HIGH' ? C.down : e.impactLabel === 'MEDIUM' ? C.amber : C.textMute,
                },
              }, e.impactLabel),
            h('span', null, e.title),
            e.relatedPillars?.length > 0 &&
              h('span', { style: { fontSize: 9, color: C.teal } }, 'thesis驗證點'),
          )
        )
      ),

    // Holding status with thesis scorecard
    sections.holdingStatus?.length > 0 &&
      h(
        'div',
        { style: { marginBottom: 8 } },
        h('div', { style: { fontSize: 10, color: C.textSec, fontWeight: 600, marginBottom: 4 } }, '持倉概況'),
        sections.holdingStatus.map((s) =>
          h(
            'div',
            { key: s.code, style: { fontSize: 11, color: C.text, padding: '3px 0', display: 'flex', justifyContent: 'space-between' } },
            h('span', null,
              `${s.name} `,
              s.conviction && h('span', { style: { fontSize: 9, color: C.blue, fontWeight: 600 } }, s.conviction.toUpperCase()),
            ),
            h('span', { style: { fontSize: 10, color: C.textMute } },
              s.pillarSummary || '',
              s.stopLossDistance != null && ` 距停損 +${s.stopLossDistance.toFixed(1)}%`,
            ),
          )
        )
      ),


    // Announcements
    sections.announcements?.length > 0 &&
      h(
        'div',
        null,
        h('div', { style: { fontSize: 10, color: C.textSec, fontWeight: 600, marginBottom: 4 } }, '重大訊息'),
        sections.announcements.map((a, i) =>
          h('div', { key: i, style: { fontSize: 11, color: C.text, padding: '3px 0' } },
            `${a.code} ${a.name}：${a.title}`
          )
        )
      ),
  )
}

/**
 * Main Daily Report Panel
 */
export function DailyReportPanel({
  morningNote,
  dailyReport,
  analyzing,
  analyzeStep,
  stressResult,
  stressTesting,
  dailyExpanded,
  setDailyExpanded,
  runDailyAnalysis,
  runStressTest,
  closeStressResult,
  newsEvents,
  setTab,
  setExpandedNews,
  expandedStock: _expandedStock,
  setExpandedStock: _setExpandedStock,
  strategyBrain: _strategyBrain,
}) {
  return h(
    'div',
    null,
    // Morning note (always shown when available)
    h(MorningNoteSection, { morningNote }),

    // Empty state
    !dailyReport &&
      !analyzing &&
      h(DailyAnalysisEmpty, {
        onAnalyze: runDailyAnalysis,
        onStressTest: runStressTest,
        analyzing,
        stressTesting,
      }),

    // Analyzing state
    analyzing && h(AnalyzingState, { step: analyzeStep }),

    // Stress result
    stressResult && h(StressResult, { result: stressResult, onClose: closeStressResult }),

    // Daily report
    dailyReport &&
      h(
        'div',
        null,
        h(DailyReportSummary, {
          report: dailyReport,
          expanded: dailyExpanded,
          onToggle: () => setDailyExpanded((p) => !p),
        }),

        h(
          Button,
          {
            onClick: (ev) => {
              ev.stopPropagation()
              runDailyAnalysis()
            },
            disabled: analyzing,
            style: {
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${analyzing ? C.border : alpha(C.blue, '2a')}`,
              background: analyzing ? C.subtle : C.cardBlue,
              color: analyzing ? C.textMute : C.blue,
              fontSize: 11,
              fontWeight: 600,
              cursor: analyzing ? 'not-allowed' : 'pointer',
              marginBottom: 8,
            },
          },
          analyzing ? analyzeStep || '分析中...' : '重新分析今日收盤'
        ),

        dailyExpanded &&
          h(
            'div',
            null,
            h(HoldingsChanges, { changes: dailyReport.changes }),
            h(AnomaliesSection, { anomalies: dailyReport.anomalies }),
            h(EventCorrelations, { correlations: dailyReport.eventCorrelations }),
            h(EventAssessments, {
              assessments: dailyReport.eventAssessments,
              newsEvents,
              onNavigate: setTab,
              onNavigateExpand: (id) => setExpandedNews(new Set([id])),
            }),
            h(BrainAuditSection, { brainAudit: dailyReport.brainAudit }),
            h(NeedsReviewSection, {
              needsReview: dailyReport.needsReview,
              onNavigate: setTab,
              onExpand: (id) => setExpandedNews(new Set([id])),
            }),
            h(AIInsightSection, {
              insight: dailyReport.aiInsight,
              error: dailyReport.aiError,
              date: dailyReport.date,
              time: dailyReport.time,
            })
          )
      )
  )
}
