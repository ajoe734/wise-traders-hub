import { useCallback, useRef, useState } from 'react'
import { APP_CONFIRM_DEFAULTS } from '../lib/appMessages.js'

function createDefaultAppConfirmState() {
  return {
    open: false,
    title: APP_CONFIRM_DEFAULTS.title,
    message: '',
    confirmLabel: APP_CONFIRM_DEFAULTS.confirmLabel,
    cancelLabel: APP_CONFIRM_DEFAULTS.cancelLabel,
    tone: 'warning',
  }
}

export function useAppConfirmationDialog() {
  const [appConfirmDialog, setAppConfirmDialog] = useState(() => createDefaultAppConfirmState())
  const appConfirmResolverRef = useRef(null)

  const closeAppConfirmDialog = useCallback((result = false) => {
    setAppConfirmDialog(createDefaultAppConfirmState())
    const resolve = appConfirmResolverRef.current
    appConfirmResolverRef.current = null
    resolve?.(result)
  }, [])

  const requestAppConfirmation = useCallback(
    (options) =>
      new Promise((resolve) => {
        appConfirmResolverRef.current = resolve
        setAppConfirmDialog({
          open: true,
          title: options?.title || APP_CONFIRM_DEFAULTS.title,
          message: options?.message || '',
          confirmLabel: options?.confirmLabel || APP_CONFIRM_DEFAULTS.confirmLabel,
          cancelLabel: options?.cancelLabel || APP_CONFIRM_DEFAULTS.cancelLabel,
          tone: options?.tone || 'warning',
        })
      }),
    []
  )

  return {
    appConfirmDialog,
    requestAppConfirmation,
    closeAppConfirmDialog,
  }
}
