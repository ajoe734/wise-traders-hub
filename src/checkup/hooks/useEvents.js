/**
 * Events Hook
 *
 * Manages event tracking, status transitions, and event CRUD operations.
 */

import { useState, useCallback, useMemo } from 'react'
import { EVENT_HISTORY_LIMIT, CLOSED_EVENT_STATUSES } from '../constants.js'
import { normalizeEventRecord, normalizeNewsEvents, transitionEventStatus } from '../lib/events.js'

/**
 * Create default event draft
 */
const createDefaultEventDraft = () => ({
  date: '',
  title: '',
  detail: '',
  stocks: '',
  pred: 'up',
  predReason: '',
})

/**
 * Create default review form
 */
const createDefaultReviewForm = (overrides = {}) => ({
  actual: 'up',
  actualNote: '',
  lessons: '',
  exitDate: null,
  priceAtExit: null,
  ...overrides,
})

/**
 * Events Hook
 *
 * @param {Object} params
 * @param {string} params.activePortfolioId - Current portfolio ID
 * @param {string} params.viewMode - Current view mode
 * @param {Array} params.initialEvents - Initial events array
 * @returns {Object} Events state and operations
 */
export const useEvents = ({
  activePortfolioId: _activePortfolioId,
  viewMode: _viewMode,
  initialEvents = [],
} = {}) => {
  const [newsEvents, setNewsEvents] = useState(() => normalizeNewsEvents(initialEvents))
  const [reviewingEvent, setReviewingEvent] = useState(null)
  const [reviewForm, setReviewForm] = useState(createDefaultReviewForm())
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [newEvent, setNewEvent] = useState(createDefaultEventDraft())
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [showCalendar, setShowCalendar] = useState(false)
  const [reversalConditions, setReversalConditions] = useState(null)

  /**
   * Update events
   */
  const updateEvents = useCallback(async (pid, suffix, data) => {
    if (suffix !== 'news-events-v1') return
    const normalized = normalizeNewsEvents(data)
    setNewsEvents(normalized)
  }, [])

  /**
   * Add a new event
   */
  const addEvent = useCallback((eventData) => {
    if (!eventData) return

    const normalized = normalizeEventRecord(eventData)
    if (!normalized) return

    setNewsEvents((prev) => [normalized, ...prev].slice(0, EVENT_HISTORY_LIMIT))
  }, [])

  /**
   * Update an existing event
   */
  const updateEvent = useCallback((eventId, updates) => {
    if (!eventId) return

    setNewsEvents((prev) =>
      prev.map((event) => {
        if (event.id === eventId) {
          return normalizeEventRecord({ ...event, ...updates })
        }
        return event
      })
    )
  }, [])

  /**
   * Delete an event
   */
  const deleteEvent = useCallback((eventId) => {
    if (!eventId) return

    setNewsEvents((prev) => prev.filter((event) => event.id !== eventId))
  }, [])

  /**
   * Transition event status
   */
  const transitionEvent = useCallback((eventId, newStatus, updates = {}) => {
    if (!eventId) return

    setNewsEvents((prev) =>
      prev.map((event) => {
        if (event.id === eventId) {
          return transitionEventStatus(event, newStatus, updates)
        }
        return event
      })
    )
  }, [])

  /**
   * Start reviewing an event
   */
  const startReview = useCallback((event) => {
    if (!event) return

    const normalized = normalizeEventRecord(event)
    setReviewingEvent(normalized)
    setReviewForm(
      createDefaultReviewForm({
        actual: normalized.actual || 'up',
        actualNote: normalized.actualNote || '',
        lessons: normalized.lessons || '',
        exitDate: normalized.exitDate || null,
        priceAtExit: normalized.priceAtExit?.[Object.keys(normalized.priceAtExit || {})[0]] || null,
      })
    )
  }, [])

  /**
   * Submit event review
   */
  const submitReview = useCallback(
    (reviewData) => {
      if (!reviewingEvent) return

      const updates = {
        status: 'closed',
        exitDate: reviewData.exitDate || new Date().toISOString().slice(0, 10),
        reviewDate: reviewData.exitDate || new Date().toISOString().slice(0, 10),
        actual: reviewData.actual,
        actualNote: reviewData.actualNote,
        lessons: reviewData.lessons,
        priceAtExit: reviewData.priceAtExit
          ? { [reviewingEvent.code]: reviewData.priceAtExit }
          : null,
      }

      updateEvent(reviewingEvent.id, updates)
      setReviewingEvent(null)
      setReviewForm(createDefaultReviewForm())
    },
    [reviewingEvent, updateEvent]
  )

  /**
   * Cancel review
   */
  const cancelReview = useCallback(() => {
    setReviewingEvent(null)
    setReviewForm(createDefaultReviewForm())
  }, [])

  /**
   * Get events by status
   */
  const eventsByStatus = useMemo(() => {
    const pending = newsEvents.filter((e) => e.status === 'pending')
    const tracking = newsEvents.filter((e) => e.status === 'tracking')
    const closed = newsEvents.filter((e) => CLOSED_EVENT_STATUSES.has(e.status))

    return { pending, tracking, closed }
  }, [newsEvents])

  /**
   * Get urgent events (pending events today)
   */
  const urgentCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return newsEvents.filter((e) => e.status === 'pending' && e.eventDate === today).length
  }, [newsEvents])

  /**
   * Get today's alert summary
   */
  const todayAlertSummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todayEvents = newsEvents.filter((e) => e.eventDate === today)
    const pending = todayEvents.filter((e) => e.status === 'pending').length
    const tracking = todayEvents.filter((e) => e.status === 'tracking').length

    const parts = []
    if (pending > 0) parts.push(`${pending} 待追蹤`)
    if (tracking > 0) parts.push(`${tracking} 進行中`)
    return parts.join(' · ') || '無事件'
  }, [newsEvents])

  return {
    // State
    newsEvents,
    reviewingEvent,
    reviewForm,
    showAddEvent,
    newEvent,
    calendarMonth,
    showCalendar,
    reversalConditions,

    // Statistics
    eventsByStatus,
    urgentCount,
    todayAlertSummary,

    // Operations
    updateEvents,
    addEvent,
    updateEvent,
    deleteEvent,
    transitionEvent,
    startReview,
    submitReview,
    cancelReview,

    // Setters
    setNewsEvents,
    setReviewingEvent,
    setReviewForm,
    setShowAddEvent,
    setNewEvent,
    setCalendarMonth,
    setShowCalendar,
    setReversalConditions,

    // Helpers
    normalizeEventRecord,
    normalizeNewsEvents,
    createDefaultEventDraft,
    createDefaultReviewForm,
  }
}
