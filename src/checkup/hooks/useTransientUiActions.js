import { useCallback } from 'react'
import { STATUS_MESSAGE_TIMEOUT_MS } from '../constants.js'
import { APP_TOAST_MESSAGES } from '../lib/appMessages.js'
import { createDefaultReviewForm as createDefaultReviewFormFallback } from '../lib/eventUtils.js'

export function useTransientUiActions({
  setReversalConditions = () => {},
  flashSaved = () => {},
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
  setReviewingEvent = () => {},
  setReviewForm = () => {},
  createDefaultReviewForm = createDefaultReviewFormFallback,
}) {
  const updateReversal = useCallback(
    (code, conditions) => {
      setReversalConditions((prev) => ({
        ...(prev || {}),
        [code]: { ...conditions, updatedAt: toSlashDate() },
      }))
      flashSaved(APP_TOAST_MESSAGES.reversalSaved, STATUS_MESSAGE_TIMEOUT_MS.SHORT)
    },
    [flashSaved, setReversalConditions, toSlashDate]
  )

  const cancelReview = useCallback(() => {
    setReviewingEvent(null)
    setReviewForm(createDefaultReviewForm())
  }, [createDefaultReviewForm, setReviewForm, setReviewingEvent])

  return {
    updateReversal,
    cancelReview,
  }
}
