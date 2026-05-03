import { useEffect } from 'react'

/**
 * Step 4 a11y：任意 modal/lightbox 開啟時按 Esc 關閉。
 * onClose 為 null/undefined 時自動 noop（用 open 控制）。
 */
export function useDialogEscape(open, onClose) {
  useEffect(() => {
    if (!open || typeof onClose !== 'function') return
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])
}
