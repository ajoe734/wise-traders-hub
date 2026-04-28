// 共用：欄位聚焦/閃爍 + 多欄位錯誤逐一跳轉 toast
// 給 edgeInvoke.js 與 edgeFetchInterceptor.js 共用，避免邏輯漂移。

import { toast } from 'sonner'

const ESC = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'))

export function findFieldEl(key) {
  if (!key || typeof document === 'undefined') return null
  // 嚴格只比對 data-edge-field（避免誤命中其他屬性或 id）
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
    // 移除舊的，重啟動畫
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

/**
 * 顯示「逐一跳轉」式驗證錯誤 toast。
 * - 同時列出所有 fields，但 action 只聚焦在「目前指標」的那一個。
 * - 若有多筆，提供「下一個欄位 (i/N)」按鈕。
 */
export function showValidationToast(fnName, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return

  // 過濾出可在 DOM 找到的欄位作為跳轉佇列；找不到的仍顯示在描述中
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
        ? {
            label: `下一個：${nextLabel}`,
            onClick: () => {
              cursor = nextIdx
              flashField(focusable[cursor].key, 'error')
              render()
            },
          }
        : {
            label: '跳到欄位',
            onClick: () => flashField(cur.key, 'error'),
          },
    })
  }

  // 第一次顯示時就直接聚焦到第一個錯誤欄位
  flashField(focusable[cursor].key, 'error')
  render()
  console.error(`[edge][${fnName}] validation failed`, fields)
}

export function showCoerceToast(fnName, fixes) {
  if (!fixes || fixes.length === 0) return
  const lines = fixes.map((f) => {
    const preview = typeof f.after === 'string' ? f.after : JSON.stringify(f.after)
    const shown = preview.length > 140 ? preview.slice(0, 137) + '…' : preview
    return `• ${f.label}：${f.summary || '已標準化'}\n  修正後：${shown}`
  }).join('\n')

  const applicable = fixes.find((f) =>
    typeof window !== 'undefined' &&
    window.__edgeFieldApply &&
    typeof window.__edgeFieldApply[f.key] === 'function'
  )

  toast.message(`已自動修正 — ${fnName}`, {
    description: lines,
    duration: 6000,
    action: applicable
      ? {
          label: '套用到輸入框',
          onClick: () => {
            try {
              const valueToApply = typeof applicable.after === 'string'
                ? applicable.after
                : (Array.isArray(applicable.after) ? applicable.after.join('、') : String(applicable.after))
              window.__edgeFieldApply[applicable.key](valueToApply)
              flashField(applicable.key, 'info')
              toast.success(`已套用到「${applicable.label}」`)
            } catch (err) {
              console.error('[edge] apply fix failed', err)
            }
          },
        }
      : undefined,
  })
  console.info(`[edge][${fnName}] auto-coerced`, fixes)
}
