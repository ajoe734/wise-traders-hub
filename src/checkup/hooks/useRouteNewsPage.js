import { useCallback, useMemo, useState } from 'react'
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

  const resetReview = useCallback(() => {
    setReviewingEvent(null)
    setReviewForm(createDefaultReviewForm())
  }, [createDefaultReviewForm])

  const submitReview = useCallback(() => {
    if (!reviewingEvent) return
    const reviewDate = reviewForm.exitDate || new Date().toISOString().slice(0, 10)

    updateEvent(reviewingEvent.id, {
      status: 'closed',
      exitDate: reviewDate,
      reviewDate,
      actual: reviewForm.actual,
      actualNote: reviewForm.actualNote,
      lessons: reviewForm.lessons,
      priceAtExit: reviewForm.priceAtExit
        ? { [reviewingEvent.code]: reviewForm.priceAtExit }
        : null,
    })

    resetReview()
  }, [resetReview, reviewForm, reviewingEvent, updateEvent])

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
