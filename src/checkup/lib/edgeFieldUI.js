// 共用：欄位聚焦/閃爍 + 多欄位錯誤逐一跳轉 toast + 自動修正彙整 toast
// 給 edgeInvoke.js 與 edgeFetchInterceptor.js 共用，避免邏輯漂移。

import { toast } from 'sonner'

const ESC = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'))

export function findFieldEl(key) {
  if (!key || typeof document === 'undefined') return null
  return document.querySelector(`[data-edge-field="${ESC(key)}"]`)
}

export function flashField(key, variant = 'error') {
  const el = findFieldEl(key)
  if (!el) return false
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (typeof el.focus === 'function') {
      setTimeout(() => { try { el.focus({ preventScroll: true }) } catch { /* noop */ } }, 320)
    }
    const cls = variant === 'error' ? 'edge-field-flash-error' : 'edge-field-flash'
    el.classList.remove(cls)
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth
    el.classList.add(cls)
    setTimeout(() => el.classList.remove(cls), 1600)
    return true
  } catch {
    return false
  }
}

function formatLine(f) {
  const parts = [`• ${f.label}：${f.reason}`]
  if (f.example) parts.push(`  範例：${f.example}`)
  if (f.hint) parts.push(`  ${f.hint}`)
  return parts.join('\n')
}

export function showValidationToast(fnName, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return
  const focusable = fields.filter((f) => f.key && findFieldEl(f.key))
  const total = focusable.length
  const description = fields.map(formatLine).join('\n')
  const baseTitle = `參數錯誤 — ${fnName}`

  if (total === 0) {
    toast.error(baseTitle, { description, duration: 8000 })
    console.error(`[edge][${fnName}] validation failed`, fields)
    return
  }

  let cursor = 0
  const toastId = `edge-validation-${fnName}-${Date.now()}`
  const render = () => {
    const cur = focusable[cursor]
    const hasNext = total > 1
    const nextIdx = (cursor + 1) % total
    const nextLabel = focusable[nextIdx]?.label || focusable[nextIdx]?.key
    const title = total > 1
      ? `${baseTitle}（${cursor + 1}/${total}）→ ${cur.label}`
      : `${baseTitle} → ${cur.label}`
    toast.error(title, {
      id: toastId,
      description,
      duration: 12000,
      action: hasNext
        ? { label: `下一個：${nextLabel}`, onClick: () => { cursor = nextIdx; flashField(focusable[cursor].key, 'error'); render() } }
        : { label: '跳到欄位', onClick: () => flashField(cur.key, 'error') },
    })
  }
  flashField(focusable[cursor].key, 'error')
  render()
  console.error(`[edge][${fnName}] validation failed`, fields)
}

// ── 自動修正 toast（彙整版）────────────────────────────────

function truncate(s, n = 140) {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : s
}

function fixSummaryLine(f) {
  const preview = typeof f.after === 'string' ? f.after : JSON.stringify(f.after)
  return `• ${f.label}：${f.summary || '已標準化'}\n  修正後：${truncate(preview)}`
}

function duplicatesDetailLines(fixes) {
  // 「查看重複明細」展開後顯示：每個欄位 → 每個重複項與次數
  const blocks = []
  for (const f of fixes) {
    if (!f.duplicates || f.duplicates.length === 0) continue
    const head = `▸ ${f.label}（共去除 ${f.removedDuplicates || 0} 項）`
    const items = f.duplicates
      .slice() // copy
      .sort((a, b) => b.count - a.count)
      .map((d) => `   ・${d.item} ×${d.count}`)
      .join('\n')
    blocks.push(`${head}\n${items}`)
  }
  return blocks.join('\n')
}

/**
 * 顯示「彙整自動修正」toast。
 * - 多個欄位的 fixes 合併到同一個 toast，標題寫總共去除幾項。
 * - 若任一欄位有重複，提供「查看重複明細」action，按下後切換為展開模式。
 * - 若有可套用的欄位（window.__edgeFieldApply[key]），主 action 改為「套用第一個修正」。
 */
export function showCoerceToast(fnName, fixes) {
  if (!fixes || fixes.length === 0) return

  const totalDup = fixes.reduce((sum, f) => sum + (f.removedDuplicates || 0), 0)
  const hasDup = totalDup > 0
  const title = hasDup
    ? `已自動修正 — ${fnName}（${fixes.length} 個欄位、去除 ${totalDup} 項重複）`
    : `已自動修正 — ${fnName}（${fixes.length} 個欄位）`

  const summaryDesc = fixes.map(fixSummaryLine).join('\n')
  const detailDesc = `${summaryDesc}\n\n── 重複明細 ──\n${duplicatesDetailLines(fixes)}`

  const applicable = fixes.find((f) =>
    typeof window !== 'undefined' &&
    window.__edgeFieldApply &&
    typeof window.__edgeFieldApply[f.key] === 'function'
  )

  const toastId = `edge-coerce-${fnName}-${Date.now()}`
  let expanded = false

  const render = () => {
    const description = expanded ? detailDesc : summaryDesc

    // 主動作：若有可套用欄位，提供「套用到輸入框」；否則若有重複明細，提供「查看/收合明細」
    let action
    if (applicable) {
      action = {
        label: `套用「${applicable.label}」到輸入框`,
        onClick: () => {
          try {
            const v = typeof applicable.after === 'string'
              ? applicable.after
              : (Array.isArray(applicable.after) ? applicable.after.join('、') : String(applicable.after))
            window.__edgeFieldApply[applicable.key](v)
            flashField(applicable.key, 'info')
            toast.success(`已套用到「${applicable.label}」`)
          } catch (err) {
            console.error('[edge] apply fix failed', err)
          }
        },
      }
    } else if (hasDup) {
      action = {
        label: expanded ? '收合重複明細' : `查看重複明細（${totalDup}）`,
        onClick: () => { expanded = !expanded; render() },
      }
    }

    // 次要動作（cancel 在 sonner 是另一顆按鈕）：當兩種按鈕都需要時用 cancel 放第二顆
    let cancel
    if (applicable && hasDup) {
      cancel = {
        label: expanded ? '收合明細' : `查看明細（${totalDup}）`,
        onClick: () => { expanded = !expanded; render() },
      }
    }

    toast.message(title, {
      id: toastId,
      description,
      duration: expanded ? 14000 : 7000,
      action,
      cancel,
    })
  }

  render()
  console.info(`[edge][${fnName}] auto-coerced`, fixes)
}
