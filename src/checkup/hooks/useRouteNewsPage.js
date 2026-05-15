import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDefaultReviewForm as createDefaultReviewFormFallback } from '../lib/eventUtils.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'

export function useRouteNewsPage() {
  const {
    newsEvents = [],
    updateEvent = () => {},
    createDefaultReviewForm = createDefaultReviewFormFallback,
  } = usePortfolioRouteContext()

  const [reviewingEvent, setReviewingEvent] = useState(null)
  const [reviewForm, setReviewForm] = useState(() => createDefaultReviewForm())
  const [expandedNews, setExpandedNews] = useState(() => new Set())

  // refs to avoid recreating callbacks on every keystroke
  const reviewFormRef = useRef(reviewForm)
  const reviewingEventRef = useRef(reviewingEvent)
  const updateEventRef = useRef(updateEvent)
  useEffect(() => { reviewFormRef.current = reviewForm }, [reviewForm])
  useEffect(() => { reviewingEventRef.current = reviewingEvent }, [reviewingEvent])
  useEffect(() => { updateEventRef.current = updateEvent }, [updateEvent])

  const resetReview = useCallback(() => {
    setReviewingEvent(null)
    setReviewForm(createDefaultReviewForm())
  }, [createDefaultReviewForm])

  const submitReview = useCallback(() => {
    const ev = reviewingEventRef.current
    const form = reviewFormRef.current
    if (!ev) return
    const reviewDate = form.exitDate || new Date().toISOString().slice(0, 10)

    updateEventRef.current(ev.id, {
      status: 'closed',
      exitDate: reviewDate,
      reviewDate,
      actual: form.actual,
      actualNote: form.actualNote,
      lessons: form.lessons,
      priceAtExit: form.priceAtExit ? { [ev.code]: form.priceAtExit } : null,
    })

    resetReview()
  }, [resetReview])

  const cancelReview = useCallback(() => {
    resetReview()
  }, [resetReview])

  return useMemo(
    () => ({
      newsEvents,
      reviewingEvent,
      reviewForm,
      setReviewForm,
      submitReview,
      cancelReview,
      setExpandedNews,
      expandedNews,
      setReviewingEvent,
      createDefaultReviewForm,
    }),
    [
      cancelReview,
      createDefaultReviewForm,
      expandedNews,
      newsEvents,
      reviewForm,
      reviewingEvent,
      submitReview,
    ]
  )
}
