import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Card, Button } from '../common'

const lbl = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 5,
}

const TYPE_COLOR = {
  法說: C.up,
  財報: C.teal,
  營收: C.olive,
  催化: C.amber,
  操作: C.text,
  總經: C.lavender,
  權證: C.choco,
}

/**
 * Log Panel - Trade history
 */
export function LogPanel({ tradeLog }) {
  if (!tradeLog || tradeLog.length === 0) {
    return h(
      Card,
      { style: { textAlign: 'center', padding: '24px 14px' } },
      h('div', { style: { fontSize: 20, marginBottom: 6, opacity: 0.3 } }, '◌'),
      h(
        'div',
        { style: { fontSize: 12, color: C.textMute, fontWeight: 400 } },
        '還沒有交易記錄',
        h('br'),
        h('span', { style: { fontSize: 10 } }, '上傳成交截圖後自動記錄在這裡')
      )
    )
  }

  return h(
    'div',
    null,
    [...tradeLog]
      .sort((a, b) => b.id - a.id)
      .map((log) =>
        h(
          Card,
          {
            key: log.id,
            style: {
              marginBottom: 8,
              borderLeft: `2px solid ${alpha(log.action === '買進' ? C.up : C.down, '40')}`,
            },
          },
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 7 } },
              h(
                'span',
                {
                  style: {
                    background: log.action === '買進' ? C.upBg : C.downBg,
                    color: log.action === '買進' ? C.up : C.down,
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 4,
                  },
                },
                log.action
              ),
              h('span', { style: { fontSize: 14, fontWeight: 600, color: C.text } }, log.name),
              h('span', { style: { fontSize: 10, color: C.textMute } }, log.code)
            ),
            h('div', { style: { fontSize: 10, color: C.textMute } }, `${log.date} ${log.time}`)
          ),
          h(
            'div',
            { style: { fontSize: 11, color: C.textMute, marginBottom: 10 } },
            `${log.qty}股 @ ${log.price?.toLocaleString()}元`
          ),
          log.qa.map((item, i) =>
            h(
              'div',
              { key: i, style: { marginBottom: 8 } },
              h('div', { style: { fontSize: 10, color: C.textMute, marginBottom: 3 } }, item.q),
              h(
                'div',
                {
                  style: {
                    fontSize: 11,
                    color: C.textSec,
                    background: C.subtle,
                    borderRadius: 6,
                    padding: '7px 10px',
                    lineHeight: 1.7,
                  },
                },
                item.a || '（未填）'
              )
            )
          )
        )
      )
  )
}

/**
 * Event Card for News Analysis
 */
export function NewsEventCard({ event, onReview, onToggle }) {
  const tc = TYPE_COLOR[event.type] || C.textMute

  return h(
    Card,
    {
      style: {
        marginBottom: 7,
        borderLeft: `2px solid ${event.urgent ? C.up : alpha(tc, '40')}`,
        cursor: onToggle ? 'pointer' : 'default',
      },
      onClick: onToggle,
    },
    h(
      'div',
      { style: { display: 'flex', gap: 10, alignItems: 'flex-start' } },
      h(
        'div',
        { style: { minWidth: 48 } },
        h(
          'div',
          {
            style: {
              background: event.urgent ? C.upBg : alpha(tc, '15'),
              color: event.urgent ? C.up : tc,
              fontSize: 9,
              fontWeight: 600,
              padding: '2px 5px',
              borderRadius: 4,
              textAlign: 'center',
              marginBottom: 3,
            },
          },
          event.type
        ),
        h(
          'div',
          { style: { fontSize: 9, color: C.textMute, textAlign: 'center', lineHeight: 1.4 } },
          event.date
        )
      ),
      h(
        'div',
        { style: { flex: 1 } },
        h(
          'div',
          { style: { fontSize: 12, fontWeight: 500, color: event.urgent ? C.up : C.text } },
          event.label
        ),
        h(
          'div',
          { style: { fontSize: 10, color: C.textMute, marginTop: 3, lineHeight: 1.6 } },
          event.sub
        ),
        onReview &&
          h(
            Button,
            {
              onClick: (e) => {
                e.stopPropagation()
                onReview(event)
              },
              style: {
                marginTop: 6,
                padding: '4px 10px',
                borderRadius: 5,
                border: `1px solid ${alpha(C.olive, '2a')}`,
                background: 'transparent',
                color: C.olive,
                fontSize: 10,
                cursor: 'pointer',
              },
            },
            '復盤'
          )
      )
    )
  )
}

/**
 * News Analysis Panel
 */
export function NewsAnalysisPanel({
  newsEvents,
  reviewingEvent,
  reviewForm,
  setReviewForm,
  submitReview,
  cancelReview,
  setExpandedNews,
  expandedNews,
  setReviewingEvent,
  createDefaultReviewForm,
}) {
  const NE = newsEvents || []
  const past = NE.filter((e) => e.status === 'closed' || e.status === 'past').sort(
    (a, b) => b.id - a.id
  )
  const tracking = NE.filter((e) => e.status === 'tracking').sort((a, b) => a.id - b.id)
  const pending = NE.filter((e) => e.status === 'pending').sort((a, b) => a.id - b.id)

  return h(
    'div',
    null,
    // Review modal
    reviewingEvent &&
      h(
        Card,
        {
          style: { marginBottom: 10, borderLeft: `3px solid ${alpha(C.up, '40')}` },
        },
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
            { style: { ...lbl, color: C.up, marginBottom: 0 } },
            `事件復盤：${reviewingEvent.title}`
          ),
          h(Button, { onClick: cancelReview, style: { padding: '4px 10px', fontSize: 10 } }, '取消')
        ),
        h(
          'div',
          { style: { display: 'grid', gap: 8 } },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 3 } }, '實際結果'),
            h(
              'select',
              {
                value: reviewForm.actual,
                onChange: (e) => setReviewForm((prev) => ({ ...prev, actual: e.target.value })),
                style: {
                  width: '100%',
                  background: C.subtle,
                  border: `1px solid ${C.border}`,
                  borderRadius: 7,
                  padding: '8px 10px',
                  color: C.text,
                  fontSize: 12,
                  outline: 'none',
                  fontFamily: 'inherit',
                },
              },
              h('option', { value: 'up' }, '看漲 ✓'),
              h('option', { value: 'down' }, '看跌 ✗'),
              h('option', { value: 'neutral' }, '中性')
            )
          ),
          h(
            'div',
            null,
            h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 3 } }, '結果說明'),
            h('textarea', {
              value: reviewForm.actualNote,
              onChange: (e) => setReviewForm((prev) => ({ ...prev, actualNote: e.target.value })),
              placeholder: '實際漲跌幅、關鍵原因...',
              style: {
                width: '100%',
                background: C.subtle,
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                padding: '8px 10px',
                color: C.text,
                fontSize: 12,
                outline: 'none',
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: 68,
                lineHeight: 1.6,
              },
            })
          ),
          h(
            'div',
            null,
            h('div', { style: { fontSize: 9, color: C.textMute, marginBottom: 3 } }, '教訓 / 收穫'),
            h('textarea', {
              value: reviewForm.lessons,
              onChange: (e) => setReviewForm((prev) => ({ ...prev, lessons: e.target.value })),
              placeholder: '這筆事件教會了我們什麼？',
              style: {
                width: '100%',
                background: C.subtle,
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                padding: '8px 10px',
                color: C.text,
                fontSize: 12,
                outline: 'none',
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: 68,
                lineHeight: 1.6,
              },
            })
          ),
          h(
            Button,
            {
              onClick: submitReview,
              style: {
                width: '100%',
                padding: '12px',
                border: 'none',
                borderRadius: 8,
                background: alpha(C.fillTeal, '40'),
                color: C.onFill,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              },
            },
            '完成復盤'
          )
        )
      ),

    // Pending events
    pending.length > 0 &&
      h(
        Card,
        { style: { marginBottom: 10, borderLeft: `3px solid ${alpha(C.amber, '40')}` } },
        h('div', { style: { ...lbl, color: C.amber } }, `待處理 (${pending.length})`),
        pending.map((e) =>
          h(NewsEventCard, {
            key: e.id,
            event: e,
            onReview: (ev) => {
              setReviewingEvent(ev)
              setReviewForm(
                createDefaultReviewForm({
                  actual: ev.actual || 'up',
                  actualNote: ev.actualNote || '',
                  lessons: ev.lessons || '',
                })
              )
            },
          })
        )
      ),

    // Tracking events
    tracking.length > 0 &&
      h(
        Card,
        { style: { marginBottom: 10, borderLeft: `3px solid ${alpha(C.teal, '40')}` } },
        h('div', { style: { ...lbl, color: C.teal } }, `追蹤中 (${tracking.length})`),
        tracking.map((e) => h(NewsEventCard, { key: e.id, event: e }))
      ),

    // Past events
    past.length > 0 &&
      h(
        Card,
        { style: { marginBottom: 10 } },
        h('div', { style: { ...lbl } }, `歷史事件 (${past.length})`),
        past.map((e) =>
          h(NewsEventCard, {
            key: e.id,
            event: e,
            isExpanded: expandedNews?.has(e.id),
            onToggle: () => {
              const next = new Set(expandedNews || [])
              if (next.has(e.id)) next.delete(e.id)
              else next.add(e.id)
              setExpandedNews(next)
            },
          })
        )
      )
  )
}
