// @ts-nocheck
/**
 * HoldingsSectorSummary — Monocle 版
 *
 * 佈局：
 *   ┌──────────────────────────────────────────────┐
 *   │ SECTOR ─────── 產業分佈 · 依市值           │
 *   ├──────────────────────────────────────────────┤
 *   │ ▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░  (100% 帶)     │
 *   │ 0        25        50        75       100    │
 *   ├──────── 產業 ─────┬── 題材 ────┬── 策略 ────┤
 *   │ 01  半導體 40%    │ AI 5檔     │ 成長股 6檔  │
 *   │ 02  金融   22%    │ ...        │ ...         │
 *   └──────────────────────────────────────────────┘
 *
 * 憲法：零圓角、零陰影、hairline、負號 U+2212、cm-* tokens。
 * 所有 preset 邏輯（存/命/刪 2-step/排序/搜尋/重名檢查/高亮）保留。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import {
  aggregateBySector,
  HOLDING_UNCLASSIFIED_LABEL,
} from '@/checkup/lib/holdingUtils'
import { useSectorFilterPresets } from '@/checkup/lib/sectorFilterPresets'

const KIND_LABEL = { industry: '產業', theme: '題材', strategy: '策略' }
const EMPTY_SEL = { items: [], mode: 'union' }

// 產業帶用色：主色 + 4 階灰階，其餘 fill
const BAND_COLORS = [
  'var(--cm-accent)',
  'var(--cm-ink)',
  'var(--cm-ink-sub)',
  'var(--cm-ink-sec)',
  'var(--cm-ink-mute)',
  'var(--cm-hair-strong)',
]
function bandColor(i: number) {
  return BAND_COLORS[i] || 'var(--cm-hair-strong)'
}

function presetSummary(items, mode) {
  const glue = mode === 'intersection' ? ' ∩ ' : ' ∪ '
  const label = items
    .slice(0, 3)
    .map((it) => `${KIND_LABEL[it.kind] || it.kind}·${it.key}`)
    .join(glue)
  return items.length > 3 ? `${label} +${items.length - 3}` : label
}

function padNum(n: number) {
  return String(n).padStart(2, '0')
}

function HoldingsSectorSummaryImpl({
  holdings,
  stockMeta,
  overrides,
  selected,
  onSelect,
}: any) {
  // ── hooks（無條件呼叫）
  const { presets, save: savePreset, remove: removePreset, rename: renamePreset } = useSectorFilterPresets()
  const [saving, setSaving] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveConflictId, setSaveConflictId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [editConflictId, setEditConflictId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<string>(() => {
    try {
      const v = typeof localStorage !== 'undefined'
        ? localStorage.getItem('checkup:sectorFilterPresets:sort:v1')
        : null
      return v === 'name-asc' || v === 'created-asc' || v === 'created-desc' ? v : 'created-desc'
    } catch { return 'created-desc' }
  })
  const [presetSearch, setPresetSearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [indexOpen, setIndexOpen] = useState(false)
  const pendingDeleteTimer = useRef<any>(null)
  const highlightTimer = useRef<any>(null)
  const presetRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => () => {
    if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
  }, [])

  useEffect(() => {
    try { localStorage.setItem('checkup:sectorFilterPresets:sort:v1', sortMode) } catch {}
  }, [sortMode])

  // ── derived
  const hasHoldings = Array.isArray(holdings) && holdings.length > 0
  const {
    industryByValue,
    themeByCount,
    strategyByCount,
    unclassifiedCount,
    multiIndustryCount,
    warnings,
    overDiversified,
  } = hasHoldings
    ? aggregateBySector(holdings, stockMeta, overrides)
    : { industryByValue: [], themeByCount: [], strategyByCount: [], unclassifiedCount: 0, multiIndustryCount: 0, warnings: [], overDiversified: false }

  // ── 集中度編輯註記（前 3 大合計）
  // 必須在下方 early return **之前**呼叫：0 檔 → N 檔（手動新增／截圖匯入）時
  // 若這顆 useMemo 在 early return 之後，React hook 順序會由 23 變 24，
  // 直接觸發「change in the order of Hooks」而讓整頁進 error boundary。
  const top3Pct = industryByValue.slice(0, 3).reduce((s: number, x: any) => s + x.pct, 0)
  const concentrationNote = useMemo(() => {
    if (industryByValue.length === 0) return ''
    if (industryByValue.length <= 2) return ''
    const p = Math.round(top3Pct)
    if (top3Pct >= 70) return `前三大合計 ${p}%——集中度偏高。`
    if (top3Pct >= 50) return `前三大合計 ${p}%——集中度略高。`
    if (industryByValue.length > 6 && (industryByValue[0]?.pct ?? 0) < 20) {
      return `共 ${industryByValue.length} 個產業且無明顯核心倉，追蹤成本較高。`
    }
    return `前三大合計 ${p}%——分佈尚均衡。`
  }, [industryByValue, top3Pct])

  if (!hasHoldings || industryByValue.length === 0) return null


  const singleHolding = holdings.length === 1
  const sel = selected && Array.isArray(selected.items) ? selected : EMPTY_SEL
  const items = sel.items
  const mode = sel.mode === 'intersection' ? 'intersection' : 'union'

  const findIndex = (kind: string, key: string) =>
    items.findIndex((it: any) => it.kind === kind && it.key === key)
  const isSelected = (kind: string, key: string) => findIndex(kind, key) >= 0

  const emit = (next: any) => { if (typeof onSelect === 'function') onSelect(next) }
  const toggle = (kind: string, key: string) => {
    const idx = findIndex(kind, key)
    if (idx >= 0) {
      const nextItems = items.slice()
      nextItems.splice(idx, 1)
      emit({ items: nextItems, mode: nextItems.length < 2 ? 'union' : mode })
    } else {
      emit({ items: [...items, { kind, key }], mode })
    }
  }
  const removeAt = (kind: string, key: string) => {
    const nextItems = items.filter((it: any) => !(it.kind === kind && it.key === key))
    emit({ items: nextItems, mode: nextItems.length < 2 ? 'union' : mode })
  }
  const setMode = (nextMode: string) => emit({ items, mode: nextMode })
  const clearAll = () => emit({ items: [], mode: 'union' })
  const hasActive = items.length > 0

  const focusPreset = (id: string) => {
    if (!id) return
    const el = presetRefs.current.get(id)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
    setHighlightId(id)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1800)
  }

  const openSave = () => {
    setNameDraft(presetSummary(items, mode) || '')
    setSaveError(null); setSaveConflictId(null); setSaving(true)
  }
  const commitSave = () => {
    const result = savePreset(nameDraft, items, mode)
    if (result?.error === 'DUPLICATE_NAME') {
      setSaveError(`已存在同名預設「${result.conflict?.name ?? ''}」，請改用其他名稱。`)
      setSaveConflictId(result.conflict?.id ?? null)
      return
    }
    if (result?.preset) {
      setSaving(false); setNameDraft(''); setSaveError(null); setSaveConflictId(null)
    }
  }
  const applyPreset = (p: any) => {
    emit({
      items: (p.items || []).map((it: any) => ({ kind: it.kind, key: it.key })),
      mode: p.mode === 'intersection' ? 'intersection' : 'union',
    })
  }
  const startEdit = (p: any) => {
    setEditingId(p.id); setEditDraft(p.name); setEditError(null); setEditConflictId(null)
  }
  const commitRename = () => {
    if (!editingId) return
    const result = renamePreset(editingId, editDraft)
    if (result?.error === 'DUPLICATE_NAME') {
      setEditError(`已存在同名預設「${result.conflict?.name ?? ''}」，請改用其他名稱。`)
      setEditConflictId(result.conflict?.id ?? null)
      return
    }
    setEditingId(null); setEditDraft(''); setEditError(null); setEditConflictId(null)
  }
  const cancelRename = () => {
    setEditingId(null); setEditDraft(''); setEditError(null); setEditConflictId(null)
  }

  // ── 產業帶：市值 ≥1% 才進帶，其餘併入「其他」
  const bandSegs: Array<{ key: string; pct: number; color: string }> = []
  let othersPct = 0
  industryByValue.forEach((x: any, i: number) => {
    if (x.pct >= 1) bandSegs.push({ key: x.key, pct: x.pct, color: bandColor(i) })
    else othersPct += x.pct
  })
  if (othersPct > 0.01) bandSegs.push({ key: '其他', pct: othersPct, color: 'var(--cm-hair-strong)' })

  const severe = warnings.some((w: any) => w.pct > 30)

  // ── preset 列表：篩選＋排序
  const term = presetSearch.trim().toLowerCase()
  const filteredPresets = term
    ? presets.filter((p: any) => String(p.name).toLowerCase().includes(term))
    : presets
  const sortedPresets = [...filteredPresets].sort((a: any, b: any) => {
    if (sortMode === 'name-asc') return String(a.name).localeCompare(String(b.name), 'zh-Hant')
    if (sortMode === 'created-asc') return (a.createdAt || 0) - (b.createdAt || 0)
    return (b.createdAt || 0) - (a.createdAt || 0)
  })



  return (
    <section
      aria-label="持倉族群分佈"
      className="cm-num"
      style={{
        margin: '4px 0 20px',
        padding: '0',
        fontFamily: 'var(--cm-font-sans)',
        color: 'var(--cm-ink)',
      }}
    >
      {/* ═══ 節標：serif 標題 + 編輯註記 ═══ */}
      <div style={{ borderTop: '1px solid var(--cm-ink)', padding: '14px 0 10px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h3
            className="cm-serif"
            style={{ margin: 0, fontSize: 16, letterSpacing: 0, color: 'var(--cm-ink)' }}
          >
            產業分佈
          </h3>
          <span className="cm-label" style={{ color: 'var(--cm-ink-sec)', letterSpacing: '0.10em', fontSize: 10 }}>
            {industryByValue.length} 產業 / {holdings.length} 檔 · 依市值
          </span>
        </div>
        {concentrationNote && (
          <div
            className="cm-serif"
            style={{
              marginTop: 6, fontSize: 13, lineHeight: 1.55,
              color: severe ? 'var(--cm-accent)' : 'var(--cm-ink-sub)',
              letterSpacing: '0.01em',
            }}
          >
            {concentrationNote}
          </div>
        )}
      </div>


      {/* ═══ 已選條件 & 操作列 ═══ */}
      {hasActive && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '10px 0', borderBottom: '1px solid var(--cm-hair)',
          }}
        >
          <span className="cm-label" style={{ fontSize: 9 }}>FILTER</span>
          {items.map((it: any, i: number) => (
            <span
              key={`${it.kind}:${it.key}:${i}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 4px 2px 8px',
                border: '1px solid var(--cm-ink)',
                background: 'var(--cm-fill-soft)',
                fontSize: 11, letterSpacing: '0.04em', color: 'var(--cm-ink)',
              }}
            >
              <span style={{ color: 'var(--cm-ink-mute)', fontSize: 9, letterSpacing: '0.12em', marginRight: 2 }}>
                {KIND_LABEL[it.kind] || it.kind}
              </span>
              {it.key}
              <button
                type="button"
                aria-label={`移除 ${it.key}`}
                onClick={() => removeAt(it.kind, it.key)}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--cm-ink-sec)',
                  cursor: 'pointer', padding: '0 3px', fontSize: 11, lineHeight: 1,
                }}
              >×</button>
            </span>
          ))}
          {items.length >= 2 && (
            <span role="group" aria-label="條件組合方式" style={{ display: 'inline-flex', gap: 0, marginLeft: 2 }}>
              {[
                { v: 'union', label: '∪ 聯集', title: '任一條件命中即顯示' },
                { v: 'intersection', label: '∩ 交集', title: '必須同時命中所有條件' },
              ].map((o) => {
                const on = mode === o.v
                return (
                  <button
                    key={o.v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setMode(o.v)}
                    title={o.title}
                    style={{
                      fontSize: 10, padding: '2px 8px',
                      border: '1px solid var(--cm-ink)',
                      background: on ? 'var(--cm-ink)' : 'transparent',
                      color: on ? 'var(--cm-bg)' : 'var(--cm-ink)',
                      cursor: 'pointer', fontFamily: 'inherit',
                      letterSpacing: '0.08em',
                      marginLeft: -1,
                    }}
                  >{o.label}</button>
                )
              })}
            </span>
          )}
          <button
            type="button"
            onClick={openSave}
            title="把目前多選條件（含聯集/交集）存成篩選預設"
            style={{
              marginLeft: 'auto', fontSize: 10, letterSpacing: '0.12em',
              padding: '3px 10px', border: '1px solid var(--cm-ink)',
              background: 'var(--cm-bg)', color: 'var(--cm-ink)',
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            }}
          >＋ 存為預設</button>
          <button
            type="button"
            onClick={clearAll}
            style={{
              fontSize: 10, color: 'var(--cm-ink-sec)', background: 'transparent',
              border: 'none', cursor: 'pointer', padding: '2px 4px',
              textDecoration: 'underline', letterSpacing: '0.04em',
            }}
          >清除全部</button>
        </div>
      )}

      {/* ═══ 儲存 draft ═══ */}
      {saving && (
        <div
          role="dialog"
          aria-label="命名並儲存預設"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 0', borderBottom: '1px solid var(--cm-hair)',
          }}
        >
          <span className="cm-label" style={{ fontSize: 9, paddingTop: 6 }}>NAME</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {(() => {
              const trimmed = nameDraft.trim()
              const dupPreset = trimmed
                ? presets.find((p: any) => String(p.name).trim() === trimmed)
                : null
              const hasDupHint = !!dupPreset && !saveError
              return (
                <>
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => { setNameDraft(e.target.value); setSaveError(null) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitSave()
                      if (e.key === 'Escape') { setSaving(false); setNameDraft(''); setSaveError(null) }
                    }}
                    placeholder="例如：AI 半導體核心"
                    maxLength={40}
                    style={{
                      width: '100%', fontSize: 12, padding: '5px 8px',
                      border: `1px solid ${saveError ? 'var(--cm-accent)' : hasDupHint ? 'var(--cm-ink-mute)' : 'var(--cm-hair-strong)'}`,
                      borderRadius: 0, background: 'var(--cm-bg)', color: 'var(--cm-ink)',
                      fontFamily: 'inherit', outline: 'none', letterSpacing: '0.02em',
                    }}
                  />
                  {hasDupHint && (
                    <div style={{ fontSize: 10, color: 'var(--cm-ink-mute)', marginTop: 4 }}>
                      已存在同名預設「{dupPreset.name}」，按下儲存會被拒絕。
                    </div>
                  )}
                </>
              )
            })()}
            {saveError && (
              <div style={{ fontSize: 10, color: 'var(--cm-accent)', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>{saveError}</span>
                {saveConflictId && (
                  <button
                    type="button"
                    onClick={() => { setSaving(false); focusPreset(saveConflictId) }}
                    style={{
                      fontSize: 10, padding: '1px 6px', border: '1px solid var(--cm-accent)',
                      background: 'transparent', color: 'var(--cm-accent)', cursor: 'pointer',
                      fontFamily: 'inherit', letterSpacing: '0.04em',
                    }}
                  >跳至該預設 →</button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={commitSave}
            disabled={!nameDraft.trim() || items.length === 0}
            style={{
              fontSize: 10, padding: '5px 12px', border: '1px solid var(--cm-ink)',
              background: 'var(--cm-ink)', color: 'var(--cm-bg)',
              cursor: nameDraft.trim() && items.length > 0 ? 'pointer' : 'not-allowed',
              opacity: nameDraft.trim() && items.length > 0 ? 1 : 0.35,
              fontFamily: 'inherit', letterSpacing: '0.12em', fontWeight: 500,
            }}
          >儲存</button>
          <button
            type="button"
            onClick={() => { setSaving(false); setNameDraft('') }}
            style={{
              fontSize: 10, padding: '5px 8px', border: 'none', background: 'transparent',
              color: 'var(--cm-ink-sec)', cursor: 'pointer', fontFamily: 'inherit',
              letterSpacing: '0.08em',
            }}
          >取消</button>
        </div>
      )}

      {/* ═══ Presets 索引 ═══ */}
      {presets.length > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '10px 0', borderBottom: '1px solid var(--cm-hair)',
          }}
        >
          <span className="cm-label" style={{ fontSize: 9 }}>PRESET</span>
          <span role="group" aria-label="預設排序方式" style={{ display: 'inline-flex', gap: 0 }}>
            {[
              { v: 'created-desc', label: '新→舊', title: '建立時間：新到舊' },
              { v: 'created-asc', label: '舊→新', title: '建立時間：舊到新' },
              { v: 'name-asc', label: 'A→Z', title: '名稱：A→Z' },
            ].map((o) => {
              const on = sortMode === o.v
              return (
                <button
                  key={o.v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSortMode(o.v)}
                  title={o.title}
                  style={{
                    fontSize: 9, padding: '2px 6px',
                    border: '1px solid var(--cm-hair-strong)',
                    background: on ? 'var(--cm-ink)' : 'transparent',
                    color: on ? 'var(--cm-bg)' : 'var(--cm-ink-sec)',
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontWeight: on ? 500 : 400, letterSpacing: '0.08em',
                    marginLeft: -1,
                  }}
                >{o.label}</button>
              )
            })}
          </span>
          <input
            value={presetSearch}
            onChange={(e) => setPresetSearch(e.target.value)}
            placeholder="搜尋預設…"
            aria-label="搜尋預設名稱"
            style={{
              fontSize: 10, padding: '3px 6px',
              border: '1px solid var(--cm-hair-strong)',
              background: 'var(--cm-fill-soft)', color: 'var(--cm-ink)',
              fontFamily: 'inherit', width: 120, outline: 'none',
              letterSpacing: '0.02em', borderRadius: 0,
            }}
          />
          {presetSearch.trim() && (
            <button
              type="button"
              onClick={() => setPresetSearch('')}
              title="清除搜尋"
              style={{
                fontSize: 9, padding: '2px 5px',
                border: '1px solid var(--cm-hair-strong)',
                background: 'transparent', color: 'var(--cm-ink-sec)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >×</button>
          )}
          <span style={{ fontSize: 9, color: 'var(--cm-ink-mute)', letterSpacing: '0.12em', marginLeft: 'auto' }}>
            {sortedPresets.length}/{presets.length}
          </span>

          <div style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {sortedPresets.map((p: any) => {
              const isHighlighted = highlightId === p.id
              const isEditing = editingId === p.id
              return (
                <span
                  key={p.id}
                  ref={(el) => {
                    if (el) presetRefs.current.set(p.id, el)
                    else presetRefs.current.delete(p.id)
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 0,
                    border: `1px solid ${isHighlighted ? 'var(--cm-accent)' : isEditing ? 'var(--cm-ink)' : 'var(--cm-hair-strong)'}`,
                    background: isHighlighted ? 'var(--cm-fill)' : isEditing ? 'var(--cm-fill-soft)' : 'var(--cm-bg)',
                    transition: 'border-color 0.2s ease, background 0.2s ease',
                  }}
                >
                  {isEditing ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <input
                          autoFocus
                          value={editDraft}
                          onChange={(e) => { setEditDraft(e.target.value); setEditError(null) }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') cancelRename()
                          }}
                          maxLength={40}
                          style={{
                            fontSize: 11, padding: '3px 6px',
                            border: `1px solid ${editError ? 'var(--cm-accent)' : 'var(--cm-ink)'}`,
                            background: 'var(--cm-bg)', color: 'var(--cm-ink)',
                            fontFamily: 'inherit', outline: 'none', width: 130,
                            borderRadius: 0, letterSpacing: '0.02em',
                          }}
                        />
                        {editError && (
                          <div style={{ fontSize: 9, color: 'var(--cm-accent)', marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span>{editError}</span>
                            {editConflictId && (
                              <button
                                type="button"
                                onClick={() => { cancelRename(); focusPreset(editConflictId) }}
                                style={{
                                  fontSize: 9, padding: '1px 5px',
                                  border: '1px solid var(--cm-accent)',
                                  background: 'transparent', color: 'var(--cm-accent)',
                                  cursor: 'pointer', fontFamily: 'inherit',
                                }}
                              >跳至 →</button>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label="確認重新命名"
                        onClick={commitRename}
                        disabled={!editDraft.trim()}
                        style={{
                          fontSize: 11, padding: '3px 6px', background: 'transparent', border: 'none',
                          color: editDraft.trim() ? 'var(--cm-ink)' : 'var(--cm-ink-mute)',
                          cursor: editDraft.trim() ? 'pointer' : 'not-allowed', lineHeight: 1,
                        }}
                      >✓</button>
                      <button
                        type="button"
                        aria-label="取消重新命名"
                        onClick={cancelRename}
                        style={{
                          fontSize: 11, padding: '3px 6px', background: 'transparent', border: 'none',
                          color: 'var(--cm-ink-sec)', cursor: 'pointer', lineHeight: 1,
                        }}
                      >×</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => applyPreset(p)}
                        title={presetSummary(p.items, p.mode)}
                        style={{
                          fontSize: 11, padding: '4px 6px 4px 10px',
                          background: 'transparent', border: 'none', color: 'var(--cm-ink)',
                          cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.02em',
                          maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {p.name}
                        <span style={{ color: 'var(--cm-ink-mute)', marginLeft: 8, fontSize: 9, letterSpacing: '0.12em' }}>
                          {padNum(p.items.length)} · {p.mode === 'intersection' ? '∩' : '∪'}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`重新命名預設 ${p.name}`}
                        onClick={() => startEdit(p)}
                        style={{
                          fontSize: 11, padding: '3px 5px', background: 'transparent', border: 'none',
                          color: 'var(--cm-ink-sec)', cursor: 'pointer', lineHeight: 1,
                        }}
                      >✎</button>
                      <button
                        type="button"
                        aria-label={pendingDeleteId === p.id ? `確認刪除預設 ${p.name}` : `刪除預設 ${p.name}`}
                        title={pendingDeleteId === p.id ? '再點一次確認刪除' : `刪除預設「${p.name}」`}
                        onClick={() => {
                          if (pendingDeleteId === p.id) {
                            if (pendingDeleteTimer.current) { clearTimeout(pendingDeleteTimer.current); pendingDeleteTimer.current = null }
                            setPendingDeleteId(null); removePreset(p.id)
                          } else {
                            setPendingDeleteId(p.id)
                            if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
                            pendingDeleteTimer.current = setTimeout(() => {
                              setPendingDeleteId(null); pendingDeleteTimer.current = null
                            }, 3000)
                          }
                        }}
                        onBlur={() => {
                          if (pendingDeleteId === p.id) {
                            if (pendingDeleteTimer.current) { clearTimeout(pendingDeleteTimer.current); pendingDeleteTimer.current = null }
                            setPendingDeleteId(null)
                          }
                        }}
                        style={{
                          fontSize: pendingDeleteId === p.id ? 10 : 11,
                          padding: pendingDeleteId === p.id ? '3px 8px' : '3px 8px 3px 4px',
                          background: pendingDeleteId === p.id ? 'var(--cm-accent)' : 'transparent',
                          border: pendingDeleteId === p.id ? '1px solid var(--cm-accent)' : 'none',
                          color: pendingDeleteId === p.id ? '#FFF' : 'var(--cm-ink-sec)',
                          cursor: 'pointer', lineHeight: 1,
                          letterSpacing: pendingDeleteId === p.id ? '0.14em' : 0,
                          fontWeight: pendingDeleteId === p.id ? 500 : 400,
                        }}
                      >
                        {pendingDeleteId === p.id ? '確認刪除' : '×'}
                      </button>
                    </>
                  )}
                </span>
              )
            })}
            {sortedPresets.length === 0 && (
              <span style={{ fontSize: 10, color: 'var(--cm-ink-mute)', padding: '4px 0', letterSpacing: '0.04em' }}>
                無符合「{presetSearch.trim()}」的預設。
              </span>
            )}
          </div>
        </div>
      )}

      {/* ═══ 100% 產業帶（高 34px + 2px 白縫） ═══ */}
      <div style={{ padding: '8px 0 6px' }}>
        <div
          role="img"
          aria-label={`產業市值分佈：${bandSegs.map((s) => `${s.key} ${s.pct.toFixed(0)}%`).join('、')}`}
          style={{
            display: 'flex', width: '100%', height: 34,
            background: 'var(--cm-bg)',
          }}
        >
          {bandSegs.map((seg, i) => {
            const isOthers = seg.key === '其他'
            const on = !isOthers && isSelected('industry', seg.key)
            return (
              <button
                key={`${seg.key}-${i}`}
                type="button"
                onClick={() => !isOthers && toggle('industry', seg.key)}
                aria-pressed={on}
                title={`${seg.key} ${seg.pct.toFixed(1)}%${isOthers ? '' : on ? '（已選，點擊移除）' : '（點擊加入條件）'}`}
                disabled={isOthers}
                style={{
                  width: `${seg.pct}%`, height: '100%',
                  background: seg.color, border: 'none', padding: 0,
                  marginRight: i < bandSegs.length - 1 ? 2 : 0,
                  cursor: isOthers ? 'default' : 'pointer',
                  outline: on ? '2px solid var(--cm-ink)' : 'none',
                  outlineOffset: -2, transition: 'filter 0.15s ease',
                }}
              />
            )
          })}
        </div>
        {/* 帶下標籤列：前 3–4 名 + 其他 */}
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '4px 14px',
            marginTop: 8, fontSize: 11, color: 'var(--cm-ink-sub)',
            letterSpacing: '0.02em',
          }}
        >
          {bandSegs.slice(0, 4).map((seg, i) => (
            <span key={`lbl-${seg.key}-${i}`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <span
                aria-hidden
                style={{ width: 8, height: 8, background: seg.color, display: 'inline-block' }}
              />
              <span>{seg.key}</span>
              <span className="cm-num" style={{ color: 'var(--cm-ink)', fontWeight: 500 }}>
                {seg.pct.toFixed(0)}%
              </span>
            </span>
          ))}
          {bandSegs.length > 4 && (
            <span style={{ color: 'var(--cm-ink-sec)' }}>
              其他 {bandSegs.slice(4).reduce((s, x) => s + x.pct, 0).toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      {/* ═══ 索引 ↓（收合三欄清單 + 篩選預設） ═══ */}
      <div style={{ marginTop: 10, borderTop: '1px solid var(--cm-hair)' }}>
        <button
          type="button"
          onClick={() => setIndexOpen((v) => !v)}
          aria-expanded={indexOpen}
          className="cm-label"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 0', background: 'transparent', border: 'none',
            color: 'var(--cm-ink)', cursor: 'pointer', fontFamily: 'inherit',
            letterSpacing: '0.14em', fontSize: 10,
          }}
        >
          索引 {indexOpen ? '↑' : '↓'}
          <span style={{ color: 'var(--cm-ink-mute)', marginLeft: 4 }}>
            產業 {industryByValue.length} · 題材 {themeByCount.length} · 策略 {strategyByCount.length}
          </span>
        </button>
        {indexOpen && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 0,
              borderTop: '1px solid var(--cm-hair)',
              borderBottom: '1px solid var(--cm-ink)',
            }}
          >
            <ColumnIndex
              title="產業"
              rows={industryByValue.map((x: any) => ({
                key: x.key,
                primary: `${x.pct.toFixed(0)}%`,
                secondary: `${x.count}檔`,
              }))}
              kind="industry"
              isSelected={isSelected}
              toggle={toggle}
              accentFirst
              isRight={false}
            />
            <ColumnIndex
              title="題材"
              rows={themeByCount.map((t: any) => ({ key: t.key, primary: `${t.count}`, secondary: '檔' }))}
              kind="theme"
              isSelected={isSelected}
              toggle={toggle}
              emptyText="無題材標籤"
            />
            <ColumnIndex
              title="策略"
              rows={strategyByCount.map((s: any) => ({ key: s.key, primary: `${s.count}`, secondary: '檔' }))}
              kind="strategy"
              isSelected={isSelected}
              toggle={toggle}
              isRight
            />
          </div>
        )}
      </div>


      {/* ═══ 附註區 ═══ */}
      {(singleHolding || overDiversified || unclassifiedCount > 0 || multiIndustryCount > 0) && (
        <div
          style={{
            marginTop: 12, paddingTop: 8,
            fontSize: 10, color: 'var(--cm-ink-sec)', lineHeight: 1.7,
            letterSpacing: '0.02em',
          }}
        >
          {singleHolding && (
            <div>— 僅 1 檔，暫無族群比較意義。</div>
          )}
          {overDiversified && !concentrationNote && (
            <div>— 產業數多且無明顯核心倉，追蹤成本較高，可考慮精簡。</div>
          )}
          {unclassifiedCount > 0 && (
            <div>— {unclassifiedCount} 檔尚未歸入產業（{HOLDING_UNCLASSIFIED_LABEL}），建議手動補上產業標籤。</div>
          )}
          {multiIndustryCount > 0 && (
            <div>— {multiIndustryCount} 檔跨多族群，市值按營收比重加權拆分。</div>
          )}
        </div>
      )}
    </section>
  )
}

function ColumnIndex({
  title, rows, kind, isSelected, toggle,
  colorFn, isRight, emptyText, accentFirst,
}: any) {
  return (
    <div
      style={{
        borderRight: isRight ? 'none' : '1px solid var(--cm-hair)',
        padding: '10px 12px',
      }}
    >
      <div
        className="cm-label"
        style={{ fontSize: 9, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}
      >
        <span>{title}</span>
        <span>{padNum(rows.length)}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 10, color: 'var(--cm-ink-mute)', padding: '4px 0' }}>
          {emptyText || '—'}
        </div>
      ) : rows.map((r: any, i: number) => {
        const on = isSelected(kind, r.key)
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => toggle(kind, r.key)}
            aria-pressed={on}
            title={on ? '再次點擊移除此條件' : '點擊加入此條件'}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              width: '100%', padding: '5px 0',
              background: 'transparent', border: 'none',
              borderBottom: i < rows.length - 1 ? '1px solid var(--cm-hair)' : 'none',
              color: 'var(--cm-ink)', cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            {colorFn ? (
              <span
                aria-hidden
                style={{
                  display: 'inline-block', width: 8, height: 8, flexShrink: 0,
                  background: colorFn(i), marginTop: 2,
                }}
              />
            ) : (
              <span
                aria-hidden
                style={{
                  fontSize: 9, color: 'var(--cm-ink-mute)', letterSpacing: '0.12em',
                  width: 18, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                }}
              >{padNum(i + 1)}</span>
            )}
            <span
              style={{
                flex: 1, fontSize: 13, lineHeight: 1.2,
                fontWeight: on ? 600 : 400,
                fontFamily: on ? 'var(--cm-font-serif)' : 'var(--cm-font-sans)',
                letterSpacing: '0.01em',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {on && <span style={{ color: 'var(--cm-accent)', marginRight: 4 }}>●</span>}
              {r.key}
            </span>
            <span
              className="cm-num"
              style={{
                fontSize: 12,
                color: accentFirst && i === 0 ? 'var(--cm-accent)' : 'var(--cm-ink)',
                fontWeight: 500,
                letterSpacing: '0.02em',
              }}
            >{r.primary}</span>
            <span style={{ fontSize: 9, color: 'var(--cm-ink-mute)', letterSpacing: '0.08em', minWidth: 26, textAlign: 'right' }}>
              {r.secondary}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const HoldingsSectorSummary = memo(HoldingsSectorSummaryImpl)
export default HoldingsSectorSummary
