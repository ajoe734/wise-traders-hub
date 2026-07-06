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
import { IND_COLOR } from '@/checkup/seedData'
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
  if (!Array.isArray(holdings) || holdings.length === 0) return null

  const {
    industryByValue,
    themeByCount,
    strategyByCount,
    totalValue,
    unclassifiedCount,
    multiIndustryCount,
    warnings,
    overDiversified,
  } = aggregateBySector(holdings, stockMeta, overrides)

  if (industryByValue.length === 0) return null

  const singleHolding = holdings.length === 1
  const sectionTitle = {
    fontSize: 9,
    color: C.textMute,
    marginBottom: 8,
    letterSpacing: '0.16em',
    fontWeight: 400,
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

  const chipBtn = (kind, key, label, tone, active) => {
    const on = isSelected(kind, key)
    return (
      <button
        key={`${kind}:${key}`}
        type="button"
        onClick={() => toggle(kind, key)}
        aria-pressed={on}
        title={on ? '再次點擊移除此條件' : '點擊加入此條件'}
        style={{
          fontSize: 10,
          padding: '3px 8px',
          borderRadius: 4,
          color: on ? C.text : active ? C.text : C.textSec,
          background: on
            ? alpha(tone || C.teal, '22')
            : active
              ? alpha(tone || C.teal, '10')
              : alpha(C.textMute, '06'),
          fontWeight: on ? 500 : active ? 500 : 400,
          letterSpacing: '0.02em',
          lineHeight: 1.6,
          border: on ? `1px solid ${alpha(tone || C.teal, '40')}` : '1px solid transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {on && <span style={{ marginRight: 4 }}>●</span>}
        {label}
      </button>
    )
  }

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
  const presetRefs = useRef(new Map())
  const highlightTimer = useRef(null)

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
  }, [])

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
        background: alpha(C.textMute, '04'),
        borderLeft: `2px solid ${alpha(C.textMute, '20')}`,
        borderRadius: 4,
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
                border: `1px solid ${saveError ? alpha(C.up, '50') : alpha(C.textMute, '25')}`,
                borderRadius: 3,
                background: saveError ? alpha(C.up, '04') : '#fff',
                color: C.text,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            {saveError && (
              <div style={{ fontSize: 10, color: C.up, marginTop: 4, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>{saveError}</span>
                {saveConflictId && (
                  <button
                    type="button"
                    onClick={() => { setSaving(false); focusPreset(saveConflictId) }}
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 3,
                      border: `1px solid ${alpha(C.up, '35')}`,
                      background: alpha(C.up, '08'),
                      color: C.up,
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
          {presets.map((p) => (
            <span
              key={p.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                borderRadius: 4,
                border: `1px solid ${editingId === p.id ? alpha(C.teal, '35') : alpha(C.textMute, '18')}`,
                background: editingId === p.id ? alpha(C.teal, '06') : alpha(C.textMute, '04'),
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
                        border: `1px solid ${editError ? alpha(C.up, '50') : alpha(C.teal, '30')}`,
                        borderRadius: 3,
                        background: editError ? alpha(C.up, '04') : (C.paper || '#fff'),
                        color: C.text,
                        fontFamily: 'inherit',
                        outline: 'none',
                        width: 120,
                        letterSpacing: '0.02em',
                      }}
                    />
                    {editError && (
                      <div style={{ fontSize: 9, color: C.up, marginTop: 3, whiteSpace: 'nowrap' }}>
                        {editError}
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
                      color: editDraft.trim() ? C.teal : C.textMute,
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
                    aria-label={`刪除預設 ${p.name}`}
                    onClick={() => {
                      if (window.confirm(`刪除預設「${p.name}」？`)) removePreset(p.id)
                    }}
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
              )}
            </span>
          ))}
        </div>
      )}

      {/* ── 產業 ── */}
      <div style={sectionTitle}>產 業 分 佈（依市值）</div>

      {!singleHolding && totalValue > 0 && (
        <div
          role="img"
          aria-label="產業市值分佈長條"
          style={{
            display: 'flex',
            borderRadius: 3,
            overflow: 'hidden',
            height: 6,
            marginBottom: 10,
            background: alpha(C.textMute, '10'),
          }}
        >
          {industryByValue.map((x, i) => (
            <div
              key={x.key}
              title={`${x.key} ${x.count}檔 ${x.pct.toFixed(0)}%（點擊加入/移除條件）`}
              onClick={() => toggle('industry', x.key)}
              style={{
                width: `${x.pct}%`,
                height: '100%',
                background:
                  isSelected('industry', x.key)
                    ? IND_COLOR[x.key] || C.teal
                    : i === 0
                      ? IND_COLOR[x.key] || C.teal
                      : alpha(C.textMute, '25'),
                transition: 'width 0.4s ease',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {industryByValue.map((x, i) => {
          const isTop = i === 0 && !singleHolding
          const label = `${x.key} ${x.count}檔${totalValue > 0 ? ` ${x.pct.toFixed(0)}%` : ''}`
          return chipBtn('industry', x.key, label, IND_COLOR[x.key], isTop)
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
            borderLeft: `2px solid ${alpha(C.amber, '30')}`,
            background: alpha(C.amber, '04'),
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 10,
            fontSize: 10,
            color: C.amber,
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
          <div style={{ ...sectionTitle, marginTop: 6 }}>題 材 曝 險（依檔數）</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {themeByCount.map((t) =>
              chipBtn('theme', t.key, `${t.key} ${t.count}`, C.teal, false),
            )}
          </div>
        </>
      )}

      {/* ── 策略 ── */}
      {strategyByCount.length > 0 && (
        <>
          <div style={{ ...sectionTitle, marginTop: 6 }}>策 略（依檔數）</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {strategyByCount.map((s) => {
              const isUncat = s.key === HOLDING_UNCLASSIFIED_LABEL
              return chipBtn(
                'strategy',
                s.key,
                `${s.key} ${s.count}`,
                isUncat ? C.textMute : C.textSec,
                false,
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
