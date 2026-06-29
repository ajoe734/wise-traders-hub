import { createElement as h, useState, useCallback } from 'react'
import { C, alpha } from '../theme.js'

// Toast context
const toastListeners = []

export function addToast(message, type = 'info', duration = 5000) {
  const id = Date.now()
  toastListeners.forEach((listener) => listener({ id, message, type, duration }))
  return id
}

export function removeToast(id) {
  toastListeners.forEach((listener) => listener({ id, remove: true }))
}

export function useToast() {
  const [toasts, setToasts] = useState([])

  const add = useCallback((message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type, duration }])

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }

    return id
  }, [])

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, add, remove }
}

export function ToastContainer({ toasts, remove }) {
  if (!toasts || toasts.length === 0) return null

  const getTypeStyles = (type) => {
    switch (type) {
      case 'success':
        return { bg: C.oliveBg, border: alpha(C.olive, '40'), color: C.olive }
      case 'error':
        return { bg: C.upBg, border: alpha(C.up, '40'), color: C.up }
      case 'warning':
        return { bg: C.amberBg, border: alpha(C.amber, '40'), color: C.amber }
      default:
        return { bg: C.blueBg, border: alpha(C.blue, '40'), color: C.blue }
    }
  }

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return '✓'
      case 'error':
        return '✕'
      case 'warning':
        return '⚠'
      default:
        return 'ℹ'
    }
  }

  return h(
    'div',
    {
      style: {
        position: 'fixed',
        top: 20,
        left: 12,
        right: 12,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'none',
      },
    },
    toasts.map((toast) => {
      const styles = getTypeStyles(toast.type)
      return h(
        'div',
        {
          key: toast.id,
          style: {
            background: styles.bg,
            border: `1px solid ${styles.border}`,
            borderRadius: 8,
            padding: '12px 16px',
            width: '100%',
            maxWidth: 'min(400px, calc(100vw - 24px))',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            pointerEvents: 'auto',
            animation: 'slideIn 0.3s ease-out',
          },
        },
        h('span', { style: { fontSize: 16, color: styles.color } }, getIcon(toast.type)),
        h('span', { style: { fontSize: 12, color: C.text, flex: 1 } }, toast.message),
        h(
          'button',
          {
            onClick: () => remove(toast.id),
            style: {
              background: 'transparent',
              border: 'none',
              color: C.textMute,
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
            },
          },
          '×'
        )
      )
    })
  )
}

export default ToastContainer
