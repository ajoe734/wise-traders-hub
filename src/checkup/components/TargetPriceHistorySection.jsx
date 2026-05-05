import React, { useMemo, useState } from 'react'
import { useTargetPriceHistory } from '@/checkup/hooks/useTargetPriceHistory'

function fmtDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  } catch { return '' }
}

const SOURCE_LABEL = {
  'refresh-reports': '刷新',
  'enrich-dossier': 'AI 研究',
  'weekly-cron': '每週自動',
  'manual': '手動',
}

/**
 * 目標價版本歷史（顯示於抽屜「TARGETS」區塊下方）
 * - props: code, color tokens (C, alpha)
 */
export default function TargetPriceHistorySection({ code, C, alpha, enabled = true }) {
  const { rows, loading } = useTargetPriceHistory(code, { limit: 30, enabled })
  const [open, setOpen] = useState(false)

  const stats = useMemo(() => {
    const updated = rows.filter(r => r.change_type === 'updated').length
    const added = rows.filter(r => r.change_type === 'new').length
    return { updated, added, total: rows.length }
  }, [rows])

  if (!enabled) return null
  if (!loading && rows.length === 0) return null

  return (
    <section style={{ marginBottom: 12, marginTop: -4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent',
          border: `1px solid ${alpha(C.textMute, '14')}`, borderRadius: 6,
          padding: '6px 10px', cursor: 'pointer',
          fontSize: 11, color: C.textSec, letterSpacing: '0.04em',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span>版本歷史 · {stats.total} 筆（新增 {stats.added} / 修改 {stats.updated}）</span>
        <span style={{ fontSize: 10, color: C.textMute }}>{open ? '收起 ▲' : '展開 ▼'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto' }}>
          {rows.map((r) => {
            const delta = (r.change_type === 'updated' && r.prev_target != null)
              ? Number(r.target) - Number(r.prev_target)
              : null
            const tone = delta == null ? C.textMute : delta > 0 ? C.up : delta < 0 ? C.down : C.textMute
            return (
              <div key={r.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                fontSize: 10.5, color: C.textSec,
                padding: '4px 8px', background: alpha(C.textMute, '04'), borderRadius: 4,
              }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ minWidth: 60, color: C.text }}>{r.firm || '—'}</span>
                  <span style={{ fontSize: 9, color: C.textMute, padding: '0 4px', border: `1px solid ${alpha(C.textMute, '20')}`, borderRadius: 2 }}>
                    {r.change_type === 'updated' ? '修改' : r.change_type === 'removed' ? '撤銷' : '新增'}
                  </span>
                  <span style={{ fontSize: 9, color: C.textMute }}>
                    {SOURCE_LABEL[r.source] || r.source}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  {r.prev_target != null && (
                    <span style={{ color: C.textMute, fontSize: 10, textDecoration: 'line-through' }}>
                      {Number(r.prev_target).toLocaleString()}
                    </span>
                  )}
                  <span style={{ color: tone, fontWeight: 500 }}>
                    {Number(r.target).toLocaleString()}
                    {delta != null && delta !== 0 && (
                      <span style={{ marginLeft: 3, fontSize: 9 }}>
                        ({delta > 0 ? '+' : ''}{delta.toFixed(1)})
                      </span>
                    )}
                  </span>
                  <span style={{ color: C.textMute, fontSize: 9, marginLeft: 4 }}>{fmtDate(r.created_at)}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
