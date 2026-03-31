import { useCallback, useEffect, useRef, useState } from 'react'
import { STATUS_MESSAGE_TIMEOUT_MS } from '../constants.js'

export function useSavedToast({ initialMessage = '' } = {}) {
  const [saved, setSaved] = useState(initialMessage)
  const timerRef = useRef(null)

  const clearSaved = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setSaved('')
  }, [])

  const flashSaved = useCallback((message, timeout = STATUS_MESSAGE_TIMEOUT_MS.DEFAULT) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    setSaved(String(message || ''))

    if (timeout == null || timeout <= 0) return

    timerRef.current = setTimeout(() => {
      setSaved('')
      timerRef.current = null
    }, timeout)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
    []
  )

  return {
    saved,
    flashSaved,
    clearSaved,
  }
}
