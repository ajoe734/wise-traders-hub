// @ts-nocheck
/**
 * HoldingsSectorSummary — 持倉族群分佈總覽（可多選 chip 就地篩選下方卡片牆）
 *
 * 交互：
 *   - 點任一 chip（產業／題材／策略）→ 加入條件；再點同一 chip = 移除
 *   - 已選 ≥2 條件時可切「聯集 ∪ / 交集 ∩」
 *   - 「清除全部」一次清空
 *
 * Props:
 *   selected  { items: {kind,key}[], mode: 'union'|'intersection' }
 *   onSelect  (next) => void   // next 是同結構
 */
import { memo, useEffect, useRef, useState } from 'react'

import {
  aggregateBySector,
  HOLDING_UNCLASSIFIED_LABEL,
} from '@/checkup/lib/holdingUtils'
import { useSectorFilterPresets } from '@/checkup/lib/sectorFilterPresets'

const KIND_LABEL = { industry: '產業', theme: '題材', strategy: '策略' }
const EMPTY_SEL = { items: [], mode: 'union' }

function presetSummary(items, mode) {
  const label = items
    .slice(0, 3)
    .map((it) => `${KIND_LABEL[it.kind] || it.kind}·${it.key}`)
    .join(mode === 'intersection' ? ' ∩ ' : ' ∪ ')
  return items.length > 3 ? `${label} +${items.length - 3}` : label
}

function HoldingsSectorSummaryImpl({
  holdings,
  stockMeta,
  overrides,
  C,
  alpha,
  selected,
  onSelect,
}) {
  // R1（本輪 bug 清掃 P0）：所有 hook 必須無條件呼叫，early return 一律挪到 hook 之後，
  // 否則使用者從 0 檔上傳第一檔時 hook 數量會由 0 → 15，React 拋
  // "Rendered more hooks than during the previous render" 讓整頁白屏。
  const { presets, save: savePreset, remove: removePreset, rename: renamePreset } = useSectorFilterPresets()
  const [saving, setSaving] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saveError, setSaveError] = useState(null)
  const [saveConflictId, setSaveConflictId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [editError, setEditError] = useState(null)
  const [editConflictId, setEditConflictId] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [sortMode, setSortMode] = useState(() => {
    try {
      const v = typeof localStorage !== 'undefined'
        ? localStorage.getItem('checkup:sectorFilterPresets:sort:v1')
        : null
      return v === 'name-asc' || v === 'created-asc' || v === 'created-desc' ? v : 'created-desc'
    } catch { return 'created-desc' }
  })
  const [presetSearch, setPresetSearch] = useState('')
  // C1（audit 2026-07）：以 inline 2-step 取代 window.confirm，避免瀏覽器彈窗阻塞 & a11y 差
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const pendingDeleteTimer = useRef(null)
  const presetRefs = useRef(new Map())
  const highlightTimer = useRef(null)

  useEffect(() => () => {
    if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
  }, [])

  useEffect(() => {
    try { localStorage.setItem('checkup:sectorFilterPresets:sort:v1', sortMode) } catch {}
  }, [sortMode])

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
  }, [])

  // hook 呼叫完畢，開始 derived 計算 + 條件性 return
  const hasHoldings = Array.isArray(holdings) && holdings.length > 0
  const {
    industryByValue,
    themeByCount,
    strategyByCount,
    totalValue,
    unclassifiedCount,
    multiIndustryCount,
    warnings,
    overDiversified,
  } = hasHoldings
    ? aggregateBySector(holdings, stockMeta, overrides)
    : { industryByValue: [], themeByCount: [], strategyByCount: [], totalValue: 0, unclassifiedCount: 0, multiIndustryCount: 0, warnings: [], overDiversified: false }

  if (!hasHoldings || industryByValue.length === 0) return null

  const singleHolding = holdings.length === 1
  const headerBase = {
    fontWeight: 500,
    color: C.text,
    letterSpacing: '-0.01em',
    lineHeight: 1,
  }
  const industryHeaderStyle = {
    ...headerBase,
    fontSize: 20,
    marginBottom: 12,
  }
  const sectionHeaderStyle = {
    ...headerBase,
    fontSize: 16,
    marginTop: 14,
    marginBottom: 10,
    paddingTop: 12,
    borderTop: `1px solid ${C.border}`,
  }


  const sel = selected && Array.isArray(selected.items) ? selected : EMPTY_SEL
  const items = sel.items
  const mode = sel.mode === 'intersection' ? 'intersection' : 'union'

  const findIndex = (kind, key) =>
    items.findIndex((it) => it.kind === kind && it.key === key)
  const isSelected = (kind, key) => findIndex(kind, key) >= 0

  const emit = (next) => {
    if (typeof onSelect !== 'function') return
    onSelect(next)
  }
  const toggle = (kind, key) => {
    const idx = findIndex(kind, key)
    if (idx >= 0) {
      const nextItems = items.slice()
      nextItems.splice(idx, 1)
      emit({ items: nextItems, mode: nextItems.length < 2 ? 'union' : mode })
    } else {
      emit({ items: [...items, { kind, key }], mode })
    }
  }
  const removeAt = (kind, key) => {
    const nextItems = items.filter((it) => !(it.kind === kind && it.key === key))
    emit({ items: nextItems, mode: nextItems.length < 2 ? 'union' : mode })
  }
  const setMode = (nextMode) => emit({ items, mode: nextMode })
  const clearAll = () => emit({ items: [], mode: 'union' })


  const hasActive = items.length > 0
  const modeBtnStyle = (active) => ({
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 3,
    border: `1px solid ${alpha(C.textMute, active ? '35' : '18')}`,
    background: active ? alpha(C.text, '10') : 'transparent',
    color: active ? C.text : C.textMute,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: active ? 500 : 400,
    letterSpacing: '0.04em',
  })

  // 舊 hooks 區塊已上移至函式頂端（R1）


  const focusPreset = (id) => {
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
    setSaveError(null)
    setSaveConflictId(null)
    setSaving(true)
  }
  const commitSave = () => {
    const result = savePreset(nameDraft, items, mode)
    if (result && result.error === 'DUPLICATE_NAME') {
      setSaveError(`已存在同名預設「${result.conflict?.name ?? ''}」，請改用其他名稱。`)
      setSaveConflictId(result.conflict?.id ?? null)
      return
    }
    if (result && result.preset) {
      setSaving(false)
      setNameDraft('')
      setSaveError(null)
      setSaveConflictId(null)
    }
  }
  const applyPreset = (p) => {
    emit({
      items: (p.items || []).map((it) => ({ kind: it.kind, key: it.key })),
      mode: p.mode === 'intersection' ? 'intersection' : 'union',
    })
  }

  const startEdit = (p) => {
    setEditingId(p.id)
    setEditDraft(p.name)
    setEditError(null)
    setEditConflictId(null)
  }
  const commitRename = () => {
    if (!editingId) return
    const result = renamePreset(editingId, editDraft)
    if (result && result.error === 'DUPLICATE_NAME') {
      setEditError(`已存在同名預設「${result.conflict?.name ?? ''}」，請改用其他名稱。`)
      setEditConflictId(result.conflict?.id ?? null)
      return
    }
    setEditingId(null)
    setEditDraft('')
    setEditError(null)
    setEditConflictId(null)
  }
  const cancelRename = () => {
    setEditingId(null)
    setEditDraft('')
    setEditError(null)
    setEditConflictId(null)
  }


  return (
    <section
      aria-label="持倉族群分佈"
      style={{
        margin: '4px 0 18px',
        padding: '14px 16px',
      }}
    >

      {hasActive && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 10,
            padding: '6px 10px',
            background: C.paper || '#fff',
            border: `1px solid ${alpha(C.textMute, '18')}`,
            borderRadius: 4,
            fontSize: 10,
            color: C.text,
            letterSpacing: '0.04em',
          }}
        >
          <span style={{ color: C.textMute }}>下方僅顯示</span>
          {items.map((it, i) => (
            <span
              key={`${it.kind}:${it.key}:${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 4px 2px 8px',
                background: alpha(C.text, '08'),
                borderRadius: 3,
                fontWeight: 500,
              }}
            >
              {KIND_LABEL[it.kind] || it.kind}：{it.key}
              <button
                type="button"
                aria-label={`移除 ${it.key}`}
                onClick={() => removeAt(it.kind, it.key)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: C.textMute,
                  cursor: 'pointer',
                  padding: '0 3px',
                  fontSize: 11,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </span>
          ))}
          {items.length >= 2 && (
            <span
              role="group"
              aria-label="條件組合方式"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}
            >
              <span style={{ color: C.textMute }}>組合</span>
              <button
                type="button"
                aria-pressed={mode === 'union'}
                onClick={() => setMode('union')}
                style={modeBtnStyle(mode === 'union')}
                title="任一條件命中即顯示"
              >
                聯集 ∪
              </button>
              <button
                type="button"
                aria-pressed={mode === 'intersection'}
                onClick={() => setMode('intersection')}
                style={modeBtnStyle(mode === 'intersection')}
                title="必須同時命中所有條件"
              >
                交集 ∩
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={openSave}
            title="把目前多選條件（含聯集/交集）存成篩選預設"
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: C.text,
              background: alpha(C.text, '06'),
              border: `1px solid ${alpha(C.textMute, '20')}`,
              borderRadius: 3,
              cursor: 'pointer',
              padding: '2px 8px',
              fontFamily: 'inherit',
            }}
          >
            ＋ 存為預設
          </button>
          <button
            type="button"
            onClick={clearAll}
            style={{
              fontSize: 10,
              color: C.textMute,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              textDecoration: 'underline',
            }}
          >
            清除全部
          </button>
        </div>
      )}

      {saving && (
        <div
          role="dialog"
          aria-label="命名並儲存預設"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
            padding: '6px 10px',
            background: C.paper || '#fff',
            border: `1px dashed ${alpha(C.textMute, '30')}`,
            borderRadius: 4,
          }}
        >
          <span style={{ fontSize: 10, color: C.textMute }}>預設名稱</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {(() => {
              // R9：輸入時即時檢測重名，不擋輸入但顯示灰字提示
              const trimmed = nameDraft.trim()
              const dupPreset = trimmed
                ? presets.find((p) => String(p.name).trim() === trimmed)
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
                      width: '100%',
                      fontSize: 11,
                      padding: '4px 8px',
                      border: `1px solid ${saveError ? alpha(C.text, '50') : hasDupHint ? alpha(C.textMute, '45') : alpha(C.textMute, '25')}`,
                      borderRadius: 3,
                      background: saveError ? alpha(C.text, '04') : '#fff',
                      color: C.text,
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  {hasDupHint && (
                    <div style={{ fontSize: 10, color: C.textMute, marginTop: 4, lineHeight: 1.4 }}>
                      已存在同名預設「{dupPreset.name}」，按下儲存會被拒絕。
                    </div>
                  )}
                </>
              )
            })()}
            {saveError && (
              <div style={{ fontSize: 10, color: C.text, marginTop: 4, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>{saveError}</span>
                {saveConflictId && (
                  <button
                    type="button"
                    onClick={() => { setSaving(false); focusPreset(saveConflictId) }}
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 3,
                      border: `1px solid ${alpha(C.text, '35')}`,
                      background: alpha(C.text, '08'),
                      color: C.text,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      letterSpacing: '0.02em',
                    }}
                  >
                    跳至該預設 →
                  </button>
                )}
              </div>
            )}

          </div>
          <button
            type="button"
            onClick={commitSave}
            disabled={!nameDraft.trim() || items.length === 0}
            style={{
              fontSize: 10,
              padding: '3px 10px',
              borderRadius: 3,
              border: `1px solid ${alpha(C.text, '25')}`,
              background: C.text,
              color: C.paper || '#fff',
              cursor: nameDraft.trim() && items.length > 0 ? 'pointer' : 'not-allowed',
              opacity: nameDraft.trim() && items.length > 0 ? 1 : 0.4,
              fontFamily: 'inherit',
            }}
          >
            儲存
          </button>
          <button
            type="button"
            onClick={() => { setSaving(false); setNameDraft('') }}
            style={{
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 3,
              border: 'none',
              background: 'transparent',
              color: C.textMute,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            取消
          </button>
        </div>
      )}

      {presets.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 9, color: C.textMute, letterSpacing: '0.14em', marginRight: 2 }}>
            預 設
          </span>
          <span
            role="group"
            aria-label="預設排序方式"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 4 }}
          >
            {[
              { v: 'created-desc', label: '新→舊', title: '建立時間：新到舊' },
              { v: 'created-asc', label: '舊→新', title: '建立時間：舊到新' },
              { v: 'name-asc', label: 'A→Z', title: '名稱：A→Z' },
            ].map((o) => {
              const active = sortMode === o.v
              return (
                <button
                  key={o.v}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSortMode(o.v)}
                  title={o.title}
                  style={{
                    fontSize: 9,
                    padding: '2px 6px',
                    borderRadius: 3,
                    border: `1px solid ${alpha(C.textMute, active ? '30' : '15')}`,
                    background: active ? alpha(C.text, '08') : 'transparent',
                    color: active ? C.text : C.textMute,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: active ? 500 : 400,
                    letterSpacing: '0.04em',
                    lineHeight: 1.4,
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </span>
          <input
            value={presetSearch}
            onChange={(e) => setPresetSearch(e.target.value)}
            placeholder="搜尋預設…"
            aria-label="搜尋預設名稱"
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 3,
              border: `1px solid ${alpha(C.textMute, '20')}`,
              background: alpha(C.textMute, '04'),
              color: C.text,
              fontFamily: 'inherit',
              width: 110,
              outline: 'none',
              letterSpacing: '0.02em',
            }}
          />
          {presetSearch.trim() && (
            <button
              type="button"
              onClick={() => setPresetSearch('')}
              title="清除搜尋"
              style={{
                fontSize: 9,
                padding: '2px 5px',
                borderRadius: 3,
                border: `1px solid ${alpha(C.textMute, '18')}`,
                background: 'transparent',
                color: C.textMute,
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginLeft: -2,
              }}
            >
              ✕
            </button>
          )}
          {(() => {
            const term = presetSearch.trim().toLowerCase()
            const filteredPresets = term
              ? presets.filter((p) => String(p.name).toLowerCase().includes(term))
              : presets
            return [...filteredPresets].sort((a, b) => {
              if (sortMode === 'name-asc') return String(a.name).localeCompare(String(b.name), 'zh-Hant')
              if (sortMode === 'created-asc') return (a.createdAt || 0) - (b.createdAt || 0)
              return (b.createdAt || 0) - (a.createdAt || 0)
            }).map((p) => {

            const isHighlighted = highlightId === p.id
            return (
            <span
              key={p.id}
              ref={(el) => {
                if (el) presetRefs.current.set(p.id, el)
                else presetRefs.current.delete(p.id)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                borderRadius: 4,
                border: `1px solid ${
                  isHighlighted
                    ? alpha(C.text, '55')
                    : editingId === p.id
                      ? alpha(C.text, '35')
                      : alpha(C.textMute, '18')
                }`,
                background: isHighlighted
                  ? alpha(C.text, '10')
                  : editingId === p.id
                    ? alpha(C.text, '06')
                    : alpha(C.textMute, '04'),
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}

            >

              {editingId === p.id ? (
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
                        fontSize: 10,
                        padding: '3px 6px',
                        border: `1px solid ${editError ? alpha(C.text, '50') : alpha(C.text, '30')}`,
                        borderRadius: 3,
                        background: editError ? alpha(C.text, '04') : (C.paper || '#fff'),
                        color: C.text,
                        fontFamily: 'inherit',
                        outline: 'none',
                        width: 120,
                        letterSpacing: '0.02em',
                      }}
                    />
                    {editError && (
                      <div style={{ fontSize: 9, color: C.text, marginTop: 3, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span>{editError}</span>
                        {editConflictId && (
                          <button
                            type="button"
                            onClick={() => { cancelRename(); focusPreset(editConflictId) }}
                            style={{
                              fontSize: 9,
                              padding: '1px 5px',
                              borderRadius: 3,
                              border: `1px solid ${alpha(C.text, '35')}`,
                              background: alpha(C.text, '08'),
                              color: C.text,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            跳至 →
                          </button>
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
                      fontSize: 11,
                      padding: '2px 4px',
                      background: 'transparent',
                      border: 'none',
                      color: editDraft.trim() ? C.text : C.textMute,
                      cursor: editDraft.trim() ? 'pointer' : 'not-allowed',
                      lineHeight: 1,
                    }}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    aria-label="取消重新命名"
                    onClick={cancelRename}
                    style={{
                      fontSize: 11,
                      padding: '2px 6px 2px 2px',
                      background: 'transparent',
                      border: 'none',
                      color: C.textMute,
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => applyPreset(p)}
                    title={presetSummary(p.items, p.mode)}
                    style={{
                      fontSize: 10,
                      padding: '3px 4px 3px 8px',
                      background: 'transparent',
                      border: 'none',
                      color: C.text,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      letterSpacing: '0.02em',
                      maxWidth: 200,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.name}
                    <span style={{ color: C.textMute, marginLeft: 6, fontSize: 9 }}>
                      {p.items.length}｜{p.mode === 'intersection' ? '∩' : '∪'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`重新命名預設 ${p.name}`}
                    onClick={() => startEdit(p)}
                    style={{
                      fontSize: 10,
                      padding: '2px 2px 2px 4px',
                      background: 'transparent',
                      border: 'none',
                      color: C.textMute,
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={pendingDeleteId === p.id ? `確認刪除預設 ${p.name}` : `刪除預設 ${p.name}`}
                    title={pendingDeleteId === p.id ? '再點一次確認刪除，或稍待自動取消' : `刪除預設「${p.name}」`}
                    onClick={() => {
                      if (pendingDeleteId === p.id) {
                        if (pendingDeleteTimer.current) { clearTimeout(pendingDeleteTimer.current); pendingDeleteTimer.current = null }
                        setPendingDeleteId(null)
                        removePreset(p.id)
                      } else {
                        setPendingDeleteId(p.id)
                        if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
                        pendingDeleteTimer.current = setTimeout(() => {
                          setPendingDeleteId(null)
                          pendingDeleteTimer.current = null
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
                      padding: pendingDeleteId === p.id ? '2px 6px' : '2px 6px 2px 2px',
                      background: pendingDeleteId === p.id ? C.text : 'transparent',
                      border: pendingDeleteId === p.id ? `1px solid ${C.text}` : 'none',
                      borderRadius: 2,
                      color: pendingDeleteId === p.id ? '#fff' : C.textMute,
                      cursor: 'pointer',
                      lineHeight: 1,
                      letterSpacing: pendingDeleteId === p.id ? '0.08em' : 0,
                      fontWeight: pendingDeleteId === p.id ? 500 : 400,
                    }}
                  >
                    {pendingDeleteId === p.id ? '確認刪除' : '✕'}
                  </button>
                </>
              )}
            </span>
          )})})()}


        </div>
      )}

      {/* ── 產業 ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={industryHeaderStyle}>產業分佈</span>
          <span style={{ fontSize: 13, color: C.textSec, marginLeft: 6, fontWeight: 400 }}>(依市值)</span>
        </div>
        {warnings.length > 0 && (() => {
          // R5：badge 與下方文字統一以 30% 為「建議分散」門檻；20%–30% 之間顯示為「留意」
          const severe = warnings.some((w) => w.pct > 30)
          return (
            <div
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: `1px solid ${severe ? C.text : alpha(C.textMute, '35')}`,
                color: severe ? C.text : C.textMute,
                fontSize: 10,
                letterSpacing: '0.04em',
                fontWeight: severe ? 500 : 400,
              }}
            >
              {severe ? '集中警示' : '留意集中度'}
            </div>
          )
        })()}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
        {industryByValue.map((x) => {
          const on = isSelected('industry', x.key)
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => toggle('industry', x.key)}
              aria-pressed={on}
              title={on ? '再次點擊移除此條件' : '點擊加入此條件'}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                padding: '10px 12px',
                borderRadius: 4,
                border: `1px solid ${on ? alpha(C.text, '40') : alpha(C.textMute, '10')}`,
                background: alpha(C.textMute, '02'),
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                transition: 'border-color 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, width: '100%' }}>
                <span style={{ fontSize: 22, color: C.text, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.02em' }}>
                  {x.pct.toFixed(0)}%
                </span>
                <span style={{ fontSize: 10, color: C.textMute, marginLeft: 'auto' }}>{x.count}檔</span>
              </div>
              <div style={{ fontSize: 13, color: C.textSec, marginTop: 4, lineHeight: 1.4 }}>{x.key}</div>
              {on && <div style={{ fontSize: 9, color: C.text, marginTop: 2 }}>●</div>}
            </button>
          )
        })}
      </div>

      {singleHolding && (
        <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, fontWeight: 400 }}>
          僅 1 檔，暫無族群比較意義。
        </div>
      )}

      {warnings.length > 0 && (
        <div
          role="status"
          style={{
            borderTop: `1px solid ${C.border}`,
            borderBottom: `1px solid ${C.border}`,
            background: alpha(C.textMute, '02'),
            padding: '8px 0',
            marginBottom: 10,
            fontSize: 10,
            color: C.text,
            lineHeight: 1.6,
            fontWeight: 400,
          }}
        >
          {'集中：'}
          {warnings.map((w) => `${w.key}(${w.count}檔 ${w.pct.toFixed(0)}%)`).join('、')}
          {warnings.some((w) => w.pct > 30) && ' — 建議分散風險'}
        </div>
      )}

      {overDiversified && (
        <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, fontWeight: 400, lineHeight: 1.6 }}>
          產業數多且無明顯核心倉，追蹤成本較高，可考慮精簡。
        </div>
      )}

      {unclassifiedCount > 0 && (
        <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, fontWeight: 400, lineHeight: 1.6 }}>
          {`${unclassifiedCount} 檔尚未歸入產業，建議手動補上產業標籤以獲得更準確的族群分佈。`}
        </div>
      )}

      {multiIndustryCount > 0 && (
        <div
          style={{
            fontSize: 9,
            color: C.textMute,
            marginBottom: 10,
            fontWeight: 400,
            lineHeight: 1.6,
            letterSpacing: '0.04em',
          }}
        >
          {`${multiIndustryCount} 檔跨多族群，市值按營收比重加權拆分。`}
        </div>
      )}

      {/* ── 題材 ── */}
      {themeByCount.length > 0 && (
        <>
          <div style={sectionHeaderStyle}>題材曝險</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {themeByCount.map((t) => {
              const on = isSelected('theme', t.key)
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggle('theme', t.key)}
                  aria-pressed={on}
                  title={on ? '再次點擊移除此條件' : '點擊加入此條件'}
                  style={{
                    fontSize: 13,
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: `1px solid ${on ? alpha(C.text, '40') : alpha(C.textMute, '18')}`,
                    background: alpha(C.textMute, '02'),
                    color: C.text,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    letterSpacing: '0.02em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  {on && <span style={{ marginRight: 4, color: C.text }}>●</span>}
                  {t.key} <span style={{ color: C.textSec, marginLeft: 4, fontSize: 12 }}>{t.count}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── 策略 ── */}
      {strategyByCount.length > 0 && (
        <>
          <div style={sectionHeaderStyle}>策略</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginBottom: 10 }}>
            {strategyByCount.map((s) => {
              const on = isSelected('strategy', s.key)
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggle('strategy', s.key)}
                  aria-pressed={on}
                  title={on ? '再次點擊移除此條件' : '點擊加入此條件'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 14,
                    color: C.text,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: 0,
                  }}
                >
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: on ? C.text : C.textMute }} />
                  {s.key} <span style={{ color: C.textSec, fontSize: 12 }}>{s.count}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

    </section>
  )
}

const HoldingsSectorSummary = memo(HoldingsSectorSummaryImpl)
export default HoldingsSectorSummary
