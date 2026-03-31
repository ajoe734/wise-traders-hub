import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Card } from '../common'

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
