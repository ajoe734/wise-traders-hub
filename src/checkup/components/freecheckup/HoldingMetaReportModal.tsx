// @ts-nocheck
/**
 * HoldingMetaReportModal — 個股分類回報 / 修正
 *
 * 讓使用者當場修正產業族群、題材、策略、營收比重，寫入 holding_meta_overrides。
 * 存檔後 useMetaOverrides 自動 invalidate cache，聚合面板即時更新。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { L as C, alpha } from '@/checkup/theme'

// C10 (audit 2026-07)：色彩改走 theme token（L 常數），避免散落 hex。
// 保留的字面色為語意狀態色（error / warn / success），theme 內沒有對應 token。
const STATUS_ERROR = '#B23A3A'
const STATUS_WARN = '#B57935'
const STATUS_OK = '#5A7A5F'

const CHIP_STYLE = {
  fontSize: 12,
  padding: '4px 8px',
  borderRadius: 4,
  background: alpha(C.textMute, '14'),
  cursor: 'pointer',
  userSelect: 'none',
  border: '1px solid transparent',
}

function parseCsvList(s) {
  if (!s) return []
  return s
    .split(/[,，、\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseMix(text) {
  // 每行「產業:數字」或「產業 數字」→ [{industry, pct}]
  if (!text?.trim()) return null
  const out = []
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(.+?)[\s:：]+(\d+(?:\.\d+)?)$/)
    if (!m) continue
    const pct = Number(m[2])
    if (!Number.isFinite(pct) || pct <= 0) continue
    out.push({ industry: m[1].trim(), pct })
  }
  if (out.length === 0) return null
  const total = out.reduce((s, x) => s + x.pct, 0)
  if (total <= 0) return null
  return out
}

export default function HoldingMetaReportModal({ holding, currentMeta, onClose, upsert }) {
  const [industries, setIndustries] = useState('')
  const [themes, setThemes] = useState('')
  const [strategy, setStrategy] = useState('')
  const [mixText, setMixText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Bug A2 fix：Modal a11y — ESC/body scroll lock/focus trap/focus restore
  // Bug B8 fix：saving 中不允許關閉（避免 setState on unmounted + 誤以為儲存了）
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)
  const savingRef = useRef(false)
  useEffect(() => { savingRef.current = saving }, [saving])
  const stableOnClose = useCallback(() => {
    if (savingRef.current) return
    onClose && onClose()
  }, [onClose])

  useEffect(() => {
    if (!holding) return
    const inds = currentMeta?.industries?.length
      ? currentMeta.industries
      : currentMeta?.industry
      ? [currentMeta.industry]
      : []
    setIndustries(inds.join('、'))
    setThemes((currentMeta?.themes || []).join('、'))
    setStrategy(currentMeta?.strategy || '')
    if (Array.isArray(currentMeta?.revenueMix) && currentMeta.revenueMix.length) {
      setMixText(currentMeta.revenueMix.map((m) => `${m.industry}:${Math.round(m.pct)}`).join('\n'))
    } else {
      setMixText('')
    }
    setError(null)
  }, [holding, currentMeta])

  // body scroll lock + focus restore + keyboard trap
  useEffect(() => {
    if (!holding) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const prevActive = document.activeElement
    previousFocusRef.current =
      prevActive && prevActive !== document.body ? prevActive : null

    // 初始 focus 落在 dialog 內第一個可聚焦元素
    requestAnimationFrame(() => {
      const root = dialogRef.current
      if (!root) return
      const first = root.querySelector(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
      )
      if (first && typeof first.focus === 'function') first.focus()
    })

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        stableOnClose()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll(
          'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) =>
          !el.hasAttribute('disabled') &&
          el.getAttribute('aria-hidden') !== 'true' &&
          (el.offsetParent !== null || el === document.activeElement),
      )
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        } else if (!root.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      const restore = previousFocusRef.current
      if (restore && restore.isConnected && typeof restore.focus === 'function') {
        try {
          restore.focus()
        } catch {
          /* noop */
        }
      }
    }
  }, [holding, stableOnClose])

  const mixParsed = useMemo(() => parseMix(mixText), [mixText])
  const mixTotal = mixParsed ? mixParsed.reduce((s, x) => s + x.pct, 0) : 0

  if (!holding) return null

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const indArr = parseCsvList(industries)
      const themArr = parseCsvList(themes)
      await upsert(holding.code, {
        industry: indArr[0] || null, // 舊欄位仍寫入（向後相容）
        industries: indArr.length ? indArr : null,
        themes: themArr.length ? themArr : null,
        strategy: strategy?.trim() || null,
        revenue_mix: mixParsed || null,
      })
      onClose()
    } catch (e) {
      setError(e?.message || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="回報分類錯誤"
      data-testid="holding-meta-report-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) stableOnClose() }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) stableOnClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        // 窄螢幕抽屜是 Radix Sheet（modal），會把 body 設成 pointer-events:none。
        // 本 modal portal 到 body，必須自行恢復可點擊，否則 backdrop 點擊關閉會失效。
        pointerEvents: 'auto',
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '20px 22px',
          borderRadius: 6,
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 4 }}>
          回報分類 — {holding.name || holding.code}（{holding.code}）
        </div>
        <div style={{ fontSize: 11, color: C.textMute, marginBottom: 16, lineHeight: 1.6 }}>
          你回報的分類只影響你自己的帳號，其他人不會看到。
        </div>

        <Field label="產業（多個以「、」或「,」分隔，依營收比重降冪）">
          <input
            type="text"
            value={industries}
            onChange={(e) => setIndustries(e.target.value)}
            placeholder="例：AI/伺服器、電源管理、車用電子"
            style={inputStyle}
          />
        </Field>

        <Field label="營收比重（每行一筆「產業:數字」，可留空）">
          <textarea
            value={mixText}
            onChange={(e) => setMixText(e.target.value)}
            placeholder={'AI/伺服器:40\n電源管理:35\n車用電子:25'}
            rows={4}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
          />
          {mixParsed && (
            <div style={{ fontSize: 11, color: mixTotal === 100 ? STATUS_OK : STATUS_WARN, marginTop: 4 }}>
              解析 {mixParsed.length} 筆，合計 {mixTotal.toFixed(0)}%（將自動正規化到 100%）
            </div>
          )}
        </Field>

        <Field label="題材（AI、CoWoS、高股息…以「、」分隔）">
          <input
            type="text"
            value={themes}
            onChange={(e) => setThemes(e.target.value)}
            placeholder="例：AI、CoWoS、資料中心"
            style={inputStyle}
          />
        </Field>

        <Field label="策略">
          <input
            type="text"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            placeholder="例：成長股、景氣循環、ETF/指數"
            style={inputStyle}
          />
        </Field>

        {error && (
          <div style={{ fontSize: 12, color: STATUS_ERROR, marginTop: 8 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={stableOnClose} disabled={saving} style={{ ...btnStyle, background: 'transparent', color: C.textMute, opacity: saving ? 0.5 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            取消
          </button>
          <button type="button" onClick={save} disabled={saving} style={{ ...btnStyle, background: C.text, color: C.bg }}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
  // §4：drawer 開啟時 modal 若不 portal 到 body 會被 Radix Sheet 蓋住而攔截點擊。
  if (typeof document === 'undefined') return dialog
  return createPortal(dialog, document.body)
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.textMute, letterSpacing: '0.08em', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </label>
  )
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: `1px solid ${alpha(C.textMute, '30')}`,
  borderRadius: 4,
  background: C.card,
  color: C.text,
  boxSizing: 'border-box',
}

const btnStyle = {
  padding: '8px 16px',
  fontSize: 13,
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 500,
}
