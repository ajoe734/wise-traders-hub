import { useCallback } from 'react'
import {
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  API_ENDPOINTS,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import { APP_TOAST_MESSAGES } from '../lib/appMessages.js'
import {
  attachEvidenceRefsToBrainAudit,
  ensureBrainAuditCoverage,
  enforceTaiwanHardGatesOnBrainAudit,
  mergeBrainWithAuditLifecycle,
  normalizeStrategyBrain,
  appendBrainValidationCases,
} from '../lib/brainRuntime.js'
import {
  buildEventReviewDossiers,
  buildResearchHoldingDossierContext,
} from '../lib/dossierUtils.js'
import {
  applyReviewedEventToCollection,
  buildEventReviewBrainRequestBody,
  buildReviewedEventSnapshot,
  createReviewRecordedAt,
  parseEventReviewBrainResponse,
  shouldIntegrateEventReview,
} from '../lib/eventReviewRuntime.js'
import {
  buildEventReviewEvidenceRefs,
  buildEventStockOutcomes,
  createDefaultReviewForm,
  normalizeEventRecord,
  normalizeNewsEvents,
} from '../lib/eventUtils.js'
import {
  formatPortfolioNotesContext,
  loadPortfolioData,
  savePortfolioData,
} from '../lib/portfolioUtils.js'

async function defaultRunReviewBrainRequest(body) {
  const response = await fetch(API_ENDPOINTS.ANALYZE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `復盤整合失敗 (${response.status})`)
  }
  return data
}

export function useEventReviewWorkflow({
  newsEvents = [],
  defaultNewsEvents = [],
  reviewForm = {},
  setNewsEvents = () => {},
  setReviewingEvent = () => {},
  setReviewForm = () => {},
  flashSaved = () => {},
  activePortfolioId = OWNER_PORTFOLIO_ID,
  portfolios = [],
  strategyBrain = null,
  portfolioNotes = {},
  dossierByCode = new Map(),
  setStrategyBrain = () => {},
  setBrainValidation = () => {},
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
  runReviewBrainRequest = defaultRunReviewBrainRequest,
}) {
  const appendCoachLessonToOwnerBrain = useCallback(
    async ({ event, note, lesson }) => {
      if (!event || activePortfolioId === OWNER_PORTFOLIO_ID) return

      const sourcePortfolio = portfolios.find((item) => item.id === activePortfolioId)
      const text = String(lesson || note || '').trim()
      if (!text) return

      const ownerBrain = normalizeStrategyBrain(
        await loadPortfolioData(OWNER_PORTFOLIO_ID, PORTFOLIO_ALIAS_TO_SUFFIX.strategyBrain, null),
        { allowEmpty: true }
      )
      const sourceLabel = sourcePortfolio?.name || activePortfolioId
      const coachLesson = {
        date: toSlashDate(),
        text,
        source: `${sourceLabel}-${event.title}`,
        sourcePortfolioId: activePortfolioId,
        sourceEventId: event.id,
      }
      const existing = (ownerBrain.coachLessons || []).filter(
        (item) =>
          !(
            item.sourcePortfolioId === coachLesson.sourcePortfolioId &&
            item.sourceEventId === coachLesson.sourceEventId
          )
      )
      const nextOwnerBrain = {
        ...ownerBrain,
        coachLessons: [...existing, coachLesson].slice(-100),
      }

      await savePortfolioData(
        OWNER_PORTFOLIO_ID,
        PORTFOLIO_ALIAS_TO_SUFFIX.strategyBrain,
        nextOwnerBrain
      )
    },
    [activePortfolioId, portfolios, toSlashDate]
  )

  const submitReview = useCallback(
    async (eventId) => {
      const sourceEvents = newsEvents || defaultNewsEvents
      const event = sourceEvents.find((item) => item.id === eventId)
      if (!event) return false

      const submittedForm = { ...reviewForm }
      const reviewDate = toSlashDate()
      const reviewRecordedAt = createReviewRecordedAt(reviewDate)
      const snapshot = buildReviewedEventSnapshot({
        event,
        reviewForm: submittedForm,
        reviewDate,
        dossierByCode,
        normalizeEventRecord,
        buildEventStockOutcomes,
        buildEventReviewDossiers,
        buildResearchHoldingDossierContext,
        buildEventReviewEvidenceRefs,
      })

      setNewsEvents((prev) =>
        applyReviewedEventToCollection({
          events: prev || defaultNewsEvents,
          eventId,
          reviewForm: submittedForm,
          reviewDate,
          reviewedStockOutcomes: snapshot.reviewedStockOutcomes,
          normalizeNewsEvents,
        })
      )
      setReviewingEvent(null)
      setReviewForm(createDefaultReviewForm())

      const shouldIntegrate = shouldIntegrateEventReview(
        snapshot.savedLessons,
        snapshot.savedNote,
        event
      )
      if (!shouldIntegrate) {
        flashSaved(APP_TOAST_MESSAGES.reviewSaved, STATUS_MESSAGE_TIMEOUT_MS.SHORT)
        return true
      }

      flashSaved(APP_TOAST_MESSAGES.reviewSavedIntegrating, STATUS_MESSAGE_TIMEOUT_MS.NOTICE)

      appendCoachLessonToOwnerBrain({
        event,
        note: snapshot.savedNote,
        lesson: snapshot.savedLessons,
      }).catch((error) => {
        console.error('同步 coachLessons 失敗:', error)
      })

      try {
        const currentBrain = normalizeStrategyBrain(strategyBrain, { allowEmpty: true })
        const notesContext = formatPortfolioNotesContext(portfolioNotes)
        const brainData = await runReviewBrainRequest(
          buildEventReviewBrainRequestBody({
            event,
            notesContext,
            reviewDossierContext: snapshot.reviewDossierContext,
            actual: submittedForm.actual,
            savedNote: snapshot.savedNote,
            wasCorrect: snapshot.wasCorrect,
            reviewedEvent: snapshot.reviewedEvent,
            reviewDate,
            savedLessons: snapshot.savedLessons,
            currentBrain,
          })
        )
        const { rawBrain, feedback } = parseEventReviewBrainResponse(brainData)
        let reviewBrainAudit = ensureBrainAuditCoverage(rawBrain, currentBrain, {
          dossiers: snapshot.reviewDossiers,
        })
        reviewBrainAudit = attachEvidenceRefsToBrainAudit(
          reviewBrainAudit,
          snapshot.reviewEvidenceRefs,
          {
            defaultLastValidatedAt: snapshot.reviewedEvent?.exitDate || reviewDate,
          }
        )
        reviewBrainAudit = enforceTaiwanHardGatesOnBrainAudit(reviewBrainAudit, currentBrain, {
          dossiers: snapshot.reviewDossiers,
          defaultLastValidatedAt: snapshot.reviewedEvent?.exitDate || reviewDate,
        })
        const newBrain = mergeBrainWithAuditLifecycle(rawBrain, currentBrain, reviewBrainAudit)
        setStrategyBrain(newBrain)
        if (snapshot.reviewDossiers.length > 0) {
          setBrainValidation((prev) =>
            appendBrainValidationCases(prev, {
              portfolioId: activePortfolioId,
              sourceType: 'eventReview',
              sourceRefId: String(eventId),
              dossiers: snapshot.reviewDossiers,
              brain: newBrain,
              brainAudit: reviewBrainAudit,
              capturedAt: reviewRecordedAt,
              reviewEvent: snapshot.reviewedEvent,
            })
          )
        }
        flashSaved(
          APP_TOAST_MESSAGES.reviewBrainUpdated(feedback),
          STATUS_MESSAGE_TIMEOUT_MS.EXTENDED
        )
      } catch (error) {
        console.error('復盤整合策略大腦失敗:', error)
        flashSaved(APP_TOAST_MESSAGES.reviewSaved, STATUS_MESSAGE_TIMEOUT_MS.SHORT)
      }

      return true
    },
    [
      activePortfolioId,
      appendCoachLessonToOwnerBrain,
      defaultNewsEvents,
      dossierByCode,
      flashSaved,
      newsEvents,
      portfolioNotes,
      reviewForm,
      runReviewBrainRequest,
      setBrainValidation,
      setNewsEvents,
      setReviewForm,
      setReviewingEvent,
      setStrategyBrain,
      strategyBrain,
      toSlashDate,
    ]
  )

  return { submitReview }
}
