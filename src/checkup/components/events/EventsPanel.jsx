import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Card, Button } from '../common'
import { RELAY_PLAN } from '../../seedData.js'

const TYPE_COLOR = {
  法說: C.up,
  財報: C.teal,
  營收: C.olive,
  催化: C.amber,
  操作: C.text,
  總經: C.lavender,
  權證: C.choco,
}

const CATALYST_LABELS = {
  earnings: '財報',
  corporate: '公司',
  industry: '產業',
  macro: '總經',
  technical: '技術',
}

const CATALYST_COLOR = {
  earnings: C.up,
  corporate: C.teal,
  industry: C.olive,
  macro: C.lavender,
  technical: C.amber,
}

const IMPACT_COLOR = {
  high: C.up,
  medium: C.amber,
  low: C.textMute,
}

/**
 * Relay Plan Card
 */
export function RelayPlanCard({ expanded, onToggle }) {
  return h(
    Card,
    {
      style: {
        marginBottom: 8,
        background: C.cardBlue,
        borderLeft: `3px solid ${alpha(C.teal, '40')}`,
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
        { style: { flex: 1, minWidth: 0 } },
        h(
          'div',
          {
            style: {
              fontSize: 9,
              color: C.teal,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            },
          },
          '接力計畫'
        ),
        h(
          'div',
          { style: { fontSize: 15, fontWeight: 600, color: C.text, marginTop: 3 } },
          RELAY_PLAN.title
        ),
        h(
          'div',
          { style: { fontSize: 10, color: C.textSec, marginTop: 4, lineHeight: 1.7 } },
          RELAY_PLAN.summary
        )
      ),
      h(
        Button,
        {
          onClick: onToggle,
          style: {
            borderRadius: 20,
            padding: '4px 11px',
            fontSize: 9,
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.18s ease',
            background: expanded ? C.subtleElev : alpha(C.teal, '08'),
            color: expanded ? C.text : C.teal,
            border: `1px solid ${expanded ? C.borderStrong : alpha(C.teal, '2a')}`,
          },
        },
        expanded ? '收合' : '展開完整計畫'
      )
    ),

    // Quick states
    h(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 } },
      RELAY_PLAN.quickStates.map((item) =>
        h(
          'span',
          {
            key: item.label,
            style: {
              fontSize: 9,
              padding: '4px 8px',
              borderRadius: 20,
              background: alpha(C[item.tone] || C.text, '15'),
              color: C[item.tone] || C.text,
              border: `1px solid ${alpha(C[item.tone] || C.text, '20')}`,
            },
          },
          `${item.label} · ${item.text}`
        )
      )
    ),

    // Legs grid
    h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
          gap: 8,
          marginTop: 10,
        },
      },
      RELAY_PLAN.legs.map((leg) =>
        h(
          'div',
          {
            key: leg.code,
            style: {
              background: C.subtle,
              border: `1px solid ${C.border}`,
              borderLeft: `2px solid ${alpha(C[leg.tone] || C.text, '40')}`,
              borderRadius: 9,
              padding: '10px 11px',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              },
            },
            h(
              'div',
              null,
              h(
                'div',
                { style: { fontSize: 12, fontWeight: 600, color: C.text } },
                leg.name,
                h(
                  'span',
                  { style: { fontSize: 9, color: C.textMute, fontWeight: 400 } },
                  ` ${leg.code}`
                )
              ),
              h(
                'div',
                { style: { fontSize: 9, color: C.textMute, marginTop: 2 } },
                `${leg.role} · ${leg.window}`
              )
            ),
            h(
              'span',
              {
                style: {
                  fontSize: 9,
                  padding: '2px 7px',
                  borderRadius: 20,
                  background: alpha(C[leg.tone] || C.text, '15'),
                  color: C[leg.tone] || C.text,
                },
              },
              leg.status
            )
          ),
          h(
            'div',
            {
              style: {
                fontSize: 11,
                color: C.text,
                marginTop: 9,
                fontWeight: 500,
                lineHeight: 1.6,
              },
            },
            leg.action
          ),
          h(
            'div',
            {
              style: { fontSize: 10, color: C.textSec, marginTop: 6, lineHeight: 1.7 },
            },
            `觸發：${leg.trigger}`,
            h('br'),
            `防守：${leg.stop}`
          )
        )
      )
    ),

    // Expanded content
    expanded &&
      h(
        'div',
        {
          style: {
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px solid ${C.borderSub}`,
          },
        },
        h(
          'div',
          { style: { fontSize: 10, color: C.textMute, fontWeight: 600, marginBottom: 6 } },
          '核心邏輯'
        ),
        h(
          'div',
          { style: { display: 'grid', gap: 6 } },
          RELAY_PLAN.thesis.map((item) =>
            h(
              'div',
              {
                key: item,
                style: {
                  fontSize: 10,
                  color: C.textSec,
                  lineHeight: 1.7,
                  background: C.subtle,
                  border: `1px solid ${C.borderSub}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                },
              },
              item
            )
          )
        ),

        h(
          'div',
          {
            style: {
              fontSize: 10,
              color: C.textMute,
              fontWeight: 600,
              marginTop: 10,
              marginBottom: 6,
            },
          },
          '關鍵觀察'
        ),
        h(
          'div',
          { style: { display: 'grid', gap: 6 } },
          RELAY_PLAN.indicators.map((item) =>
            h(
              'div',
              {
                key: `${item.code}-${item.when}`,
                style: {
                  background: C.subtle,
                  border: `1px solid ${C.borderSub}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                },
              },
              h(
                'div',
                { style: { fontSize: 10, color: C.text, fontWeight: 500 } },
                `${item.name} · ${item.when}`
              ),
              h(
                'div',
                { style: { fontSize: 10, color: C.textSec, marginTop: 3, lineHeight: 1.7 } },
                item.what
              )
            )
          )
        ),

        h(
          'div',
          {
            style: {
              fontSize: 10,
              color: C.textMute,
              fontWeight: 600,
              marginTop: 10,
              marginBottom: 6,
            },
          },
          '情境矩陣'
        ),
        h(
          'div',
          { style: { display: 'grid', gap: 6 } },
          RELAY_PLAN.riskMatrix.map((item) =>
            h(
              'div',
              {
                key: item.scenario,
                style: {
                  background: C.subtle,
                  border: `1px solid ${C.borderSub}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                },
              },
              h('div', { style: { fontSize: 10, color: C.text, fontWeight: 500 } }, item.scenario),
              h(
                'div',
                { style: { fontSize: 10, color: C.textSec, marginTop: 3, lineHeight: 1.7 } },
                item.action
              )
            )
          )
        ),

        h(
          'div',
          {
            style: {
              fontSize: 10,
              color: C.textMute,
              fontWeight: 600,
              marginTop: 10,
              marginBottom: 6,
            },
          },
          '資金配置'
        ),
        h(
          'div',
          { style: { display: 'grid', gap: 6 } },
          RELAY_PLAN.allocations.map((item) =>
            h(
              'div',
              {
                key: `${item.phase}-${item.target}`,
                style: {
                  background: C.subtle,
                  border: `1px solid ${C.borderSub}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                },
              },
              h(
                'div',
                { style: { fontSize: 10, color: C.text, fontWeight: 500 } },
                `${item.phase} · ${item.target}`
              ),
              h(
                'div',
                { style: { fontSize: 10, color: C.textSec, marginTop: 3, lineHeight: 1.7 } },
                item.plan
              )
            )
          )
        )
      )
  )
}

/**
 * Event Card
 */
export function EventCard({ event }) {
  const tc = TYPE_COLOR[event.type] || C.textMute

  return h(
    Card,
    {
      style: {
        marginBottom: 7,
        borderLeft: `2px solid ${event.urgent ? C.up : alpha(tc, '40')}`,
      },
    },
    h(
      'div',
      {
        style: { display: 'flex', gap: 10, alignItems: 'flex-start' },
      },
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
        event.impact &&
          h(
            'div',
            {
              style: {
                fontSize: 8,
                fontWeight: 600,
                padding: '1px 4px',
                borderRadius: 3,
                background: alpha(IMPACT_COLOR[event.impact] || C.textMute, '15'),
                color: IMPACT_COLOR[event.impact] || C.textMute,
                textAlign: 'center',
              },
            },
            event.impact.toUpperCase()
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
        )
      )
    )
  )
}

/**
 * Events Filter Buttons
 */
export function EventsFilter({ filterType, setFilterType }) {
  return h(
    'div',
    { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 } },
    ['全部', ...Object.keys(TYPE_COLOR)].map((t) =>
      h(
        Button,
        {
          key: t,
          onClick: () => setFilterType(t),
          style: {
            background: filterType === t ? C.subtleElev : 'transparent',
            color: filterType === t ? C.text : C.textMute,
            border: `1px solid ${filterType === t ? C.borderStrong : C.border}`,
            borderRadius: 20,
            padding: '3px 11px',
            fontSize: 10,
            fontWeight: 500,
            cursor: 'pointer',
          },
        },
        t
      )
    )
  )
}

/**
 * Catalyst Type Filter Buttons
 */
export function CatalystFilter({ catalystFilter, setCatalystFilter }) {
  return h(
    'div',
    { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 } },
    ['全部', ...Object.keys(CATALYST_LABELS)].map((t) =>
      h(
        Button,
        {
          key: t,
          onClick: () => setCatalystFilter(t),
          style: {
            background: catalystFilter === t ? C.subtleElev : 'transparent',
            color:
              catalystFilter === t
                ? C.text
                : t === '全部'
                  ? C.textMute
                  : CATALYST_COLOR[t] || C.textMute,
            border: `1px solid ${catalystFilter === t ? C.borderStrong : C.border}`,
            borderRadius: 20,
            padding: '3px 11px',
            fontSize: 10,
            fontWeight: 500,
            cursor: 'pointer',
          },
        },
        t === '全部' ? '全部分類' : CATALYST_LABELS[t]
      )
    )
  )
}

/**
 * Main Events Panel
 */
export function EventsPanel({
  showRelayPlan,
  relayPlanExpanded,
  setRelayPlanExpanded,
  filterType,
  setFilterType,
  filteredEvents,
  catalystFilter,
  setCatalystFilter,
}) {
  return h(
    'div',
    null,
    // Relay Plan
    showRelayPlan &&
      h(RelayPlanCard, {
        expanded: relayPlanExpanded,
        onToggle: () => setRelayPlanExpanded((v) => !v),
      }),

    // Filter buttons
    h(EventsFilter, { filterType, setFilterType }),

    // Catalyst type filter buttons (only shown if props provided)
    setCatalystFilter && h(CatalystFilter, { catalystFilter, setCatalystFilter }),

    // Events list
    filteredEvents.map((e, i) => h(EventCard, { key: i, event: e }))
  )
}
