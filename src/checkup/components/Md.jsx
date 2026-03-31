import { createElement as h } from 'react'
import { C } from '../theme.js'

// ── 輕量 Markdown → React 渲染器 ────────────────────────────────
export default function Md({ text, color }) {
  if (!text) return null
  const lines = text.split('\n')
  const els = []
  let listItems = []
  const textColor = color || C.textSec
  const flushList = () => {
    if (listItems.length > 0) {
      els.push(
        h(
          'ul',
          {
            key: `ul-${els.length}`,
            style: { margin: '4px 0 8px 6px', padding: 0, listStyle: 'none' },
          },
          listItems.map((li, j) =>
            h(
              'li',
              {
                key: j,
                style: {
                  fontSize: 11,
                  color: textColor,
                  lineHeight: 1.8,
                  paddingLeft: 12,
                  position: 'relative',
                },
              },
              h('span', { style: { position: 'absolute', left: 0, color: C.textMute } }, '·'),
              renderInline(li)
            )
          )
        )
      )
      listItems = []
    }
  }
  const renderInline = (s) => {
    // **bold** and *italic*
    const parts = []
    const rest = s
    let k = 0
    const rx = /\*\*(.+?)\*\*|\*(.+?)\*/g
    let m,
      last = 0
    while ((m = rx.exec(rest)) !== null) {
      if (m.index > last) parts.push(h('span', { key: k++ }, rest.slice(last, m.index)))
      if (m[1])
        parts.push(h('strong', { key: k++, style: { color: C.text, fontWeight: 600 } }, m[1]))
      else if (m[2]) parts.push(h('em', { key: k++, style: { fontStyle: 'italic' } }, m[2]))
      last = m.index + m[0].length
    }
    if (last < rest.length) parts.push(h('span', { key: k++ }, rest.slice(last)))
    return parts.length > 0 ? parts : rest
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,3}\s/.test(line)) {
      flushList()
      const lvlMatch = line.match(/^(#+)/)
      const lvl = lvlMatch ? lvlMatch[1].length : 1
      const txt = line.replace(/^#+\s*/, '')
      const sz = lvl === 1 ? 14 : lvl === 2 ? 12 : 11
      els.push(
        h(
          'div',
          {
            key: `h-${i}`,
            style: {
              fontSize: sz,
              fontWeight: 600,
              color: C.text,
              marginTop: lvl === 1 ? 12 : 8,
              marginBottom: 4,
            },
          },
          renderInline(txt)
        )
      )
    } else if (/^[-*]\s/.test(line.trim())) {
      listItems.push(line.trim().replace(/^[-*]\s*/, ''))
    } else if (/^\d+\.\s/.test(line.trim())) {
      flushList()
      const txt = line.trim().replace(/^\d+\.\s*/, '')
      const numMatch = line.trim().match(/^(\d+)\./)
      const num = numMatch ? numMatch[1] : '1'
      els.push(
        h(
          'div',
          {
            key: `ol-${i}`,
            style: {
              fontSize: 11,
              color: textColor,
              lineHeight: 1.8,
              paddingLeft: 12,
              position: 'relative',
              marginBottom: 2,
            },
          },
          h(
            'span',
            { style: { position: 'absolute', left: 0, color: C.textMute, fontSize: 10 } },
            `${num}.`
          ),
          renderInline(txt)
        )
      )
    } else if (line.trim() === '') {
      flushList()
      els.push(h('div', { key: `br-${i}`, style: { height: 4 } }))
    } else {
      flushList()
      els.push(
        h(
          'div',
          {
            key: `p-${i}`,
            style: { fontSize: 11, color: textColor, lineHeight: 1.8, marginBottom: 2 },
          },
          renderInline(line)
        )
      )
    }
  }
  flushList()
  return h('div', null, els)
}
