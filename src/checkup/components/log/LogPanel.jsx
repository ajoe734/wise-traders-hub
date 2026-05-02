import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Card } from '../common'

/**
 * Log Panel - Trade history
 *
 * 單色橘憲法（mem://style/holdings/monochrome-orange-pnl）：
 * 買賣不再用紅綠對撞，統一橘色＋字重區分；買=填色 chip，賣=描邊 chip。
 * 排序使用 `${date} ${time}` 字典序（YYYY/MM/DD），不依賴 id 數字精度。
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

  const sorted = [...tradeLog].sort((a, b) => {
    const ka = `${a.date || ''} ${a.time || ''}`
    const kb = `${b.date || ''} ${b.time || ''}`
    if (ka === kb) return (b.id || 0) - (a.id || 0)
    return ka < kb ? 1 : -1
  })

  return h(
    'div',
    null,
    sorted.map((log) => {
      const isBuy = log.action === '買進'
      const arrow = isBuy ? '↑' : '↓'
      return h(
        Card,
        {
          key: log.id,
          style: {
            marginBottom: 8,
            borderLeft: `2px solid ${alpha(C.accent || C.text, '40')}`,
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
                  background: isBuy ? alpha(C.accent || C.text, '12') : 'transparent',
                  color: C.accent || C.text,
                  border: `1px solid ${alpha(C.accent || C.text, '40')}`,
                  fontSize: 9,
                  fontWeight: isBuy ? 700 : 500,
                  padding: '2px 8px',
                  borderRadius: 4,
                  letterSpacing: '0.06em',
                },
              },
              `${arrow} ${isBuy ? '買' : '賣'}`
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
        (log.qa || []).map((item, i) =>
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
    })
  )
}
