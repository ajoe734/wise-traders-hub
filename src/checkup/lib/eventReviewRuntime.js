import {
  buildEventReviewBrainSystemPrompt,
  buildEventReviewBrainUserPrompt,
} from './promptTemplateCatalog.js'

export function createReviewRecordedAt(reviewDate, now = new Date()) {
  return `${reviewDate} ${now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`
}

export function shouldIntegrateEventReview(savedLessons = '', savedNote = '', event = null) {
  return Boolean(event && (String(savedLessons || '').trim() || String(savedNote || '').trim()))
}

export function buildReviewedEventSnapshot({
  event = null,
  reviewForm = {},
  reviewDate = '',
  dossierByCode = new Map(),
  normalizeEventRecord = (value) => value,
  buildEventStockOutcomes = () => [],
  buildEventReviewDossiers = () => [],
  buildResearchHoldingDossierContext = () => '',
  buildEventReviewEvidenceRefs = () => [],
}) {
  if (!event) {
    return {
      wasCorrect: null,
      savedLessons: '',
      savedNote: '',
      reviewedStockOutcomes: [],
      reviewedEvent: null,
      reviewDossiers: [],
      reviewDossierContext: '',
      reviewEvidenceRefs: [],
    }
  }

  const wasCorrect = event.pred === reviewForm.actual
  const savedLessons = String(reviewForm.lessons || '').trim()
  const savedNote = String(reviewForm.actualNote || '').trim()
  const baseReviewedEvent = normalizeEventRecord({
    ...event,
    status: 'closed',
    exitDate: reviewForm.exitDate || event.exitDate || reviewDate,
    priceAtExit: reviewForm.priceAtExit || event.priceAtExit || null,
    actual: reviewForm.actual,
    actualNote: reviewForm.actualNote,
    correct: wasCorrect,
    lessons: reviewForm.lessons,
    reviewDate,
  })
  const reviewedStockOutcomes = baseReviewedEvent ? buildEventStockOutcomes(baseReviewedEvent) : []
  const reviewedEvent = baseReviewedEvent
    ? normalizeEventRecord({
        ...baseReviewedEvent,
        stockOutcomes: reviewedStockOutcomes,
      })
    : null
  const reviewDossiers = reviewedEvent ? buildEventReviewDossiers(reviewedEvent, dossierByCode) : []
  const reviewDossierContext =
    reviewDossiers.length > 0
      ? reviewDossiers
          .map((dossier) => buildResearchHoldingDossierContext(dossier, { compact: true }))
          .join('\n\n')
      : ''
  const reviewEvidenceRefs = reviewedEvent
    ? buildEventReviewEvidenceRefs(reviewedEvent, reviewDate)
    : []

  return {
    wasCorrect,
    savedLessons,
    savedNote,
    reviewedStockOutcomes,
    reviewedEvent,
    reviewDossiers,
    reviewDossierContext,
    reviewEvidenceRefs,
  }
}

export function applyReviewedEventToCollection({
  events = [],
  eventId = '',
  reviewForm = {},
  reviewDate = '',
  reviewedStockOutcomes = [],
  normalizeNewsEvents = (value) => value,
}) {
  const normalizedEvents = normalizeNewsEvents(events)
  const index = normalizedEvents.findIndex((event) => event.id === eventId)
  if (index < 0) return normalizedEvents

  const current = normalizedEvents[index]
  normalizedEvents[index] = {
    ...current,
    status: 'closed',
    exitDate: reviewForm.exitDate || current.exitDate || reviewDate,
    priceAtExit: reviewForm.priceAtExit || current.priceAtExit || null,
    actual: reviewForm.actual,
    actualNote: reviewForm.actualNote,
    correct: current.pred === reviewForm.actual,
    lessons: reviewForm.lessons,
    reviewDate,
    stockOutcomes: reviewedStockOutcomes,
  }
  return normalizedEvents
}

export function buildEventReviewBrainRequestBody({
  event,
  notesContext = '',
  reviewDossierContext = '',
  actual,
  savedNote = '',
  wasCorrect = false,
  reviewedEvent = null,
  reviewDate = '',
  savedLessons = '',
  currentBrain = null,
}) {
  return {
    systemPrompt: buildEventReviewBrainSystemPrompt(),
    userPrompt: buildEventReviewBrainUserPrompt({
      event,
      notesContext,
      reviewDossierContext,
      actual,
      savedNote,
      wasCorrect,
      reviewedEvent,
      reviewDate,
      savedLessons,
      currentBrain,
    }),
  }
}

export function extractJsonObjectFromText(text = '') {
  const cleaned = String(text || '')
    .replace(/```json|```/g, '')
    .trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error('事件復盤 AI 回傳不是有效 JSON')
  }
  return cleaned.slice(firstBrace, lastBrace + 1)
}

export function parseEventReviewBrainResponse(data) {
  const text = data?.content?.[0]?.text || ''
  const parsed = JSON.parse(extractJsonObjectFromText(text))
  const feedback = parsed.reviewFeedback
  delete parsed.reviewFeedback
  return {
    rawBrain: parsed,
    feedback,
    text,
  }
}
