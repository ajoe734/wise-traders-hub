import { useCallback } from 'react'
import {
  OWNER_PORTFOLIO_ID,
  PORTFOLIO_ALIAS_TO_SUFFIX,
  API_ENDPOINTS,
  STATUS_MESSAGE_TIMEOUT_MS,
} from '../constants.js'
import { getCheckupGateway, parseGatewayErrorBody } from '../lib/gateway'
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
// Phase 3A.4 Step 1: store 直取 setter
import { useEventStore } from '../stores/eventStore.js'
import { useBrainStore } from '../stores/brainStore.js'

async function defaultRunReviewBrainRequest(body) {
  try {
    return await getCheckupGateway().http.json(API_ENDPOINTS.ANALYZE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const detail = parseGatewayErrorBody(err)
    throw new Error(detail?.detail || detail?.error || `復盤整合失敗 (${err?.status || 0})`)
  }
}

export function useEventReviewWorkflow({
  newsEvents = [],
  defaultNewsEvents = [],
  reviewForm = {},
  setReviewingEvent = () => {},
  setReviewForm = () => {},
  flashSaved = () => {},
  activePortfolioId = OWNER_PORTFOLIO_ID,
  portfolios = [],
  strategyBrain = null,
  portfolioNotes = {},
  dossierByCode = new Map(),
  toSlashDate = () => new Date().toLocaleDateString('zh-TW'),
  runReviewBrainRequest = defaultRunReviewBrainRequest,
}) {
  const setNewsEvents = useEventStore((s) => s.setNewsEvents)
  const setStrategyBrain = useBrainStore((s) => s.setStrategyBrain)
  const setBrainValidation = useBrainStore((s) => s.setBrainValidation)
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

      // ── Write prediction accuracy record (user-scoped) ──
      if (event.pred && submittedForm.actual) {
        const wasCorrect = event.pred === submittedForm.actual
        const gw = getCheckupGateway()
        gw.auth.getUserId().then((uid) => {
          if (!uid) return // 未登入訪客（demo 模式）不寫入
          gw.db.from('checkup_prediction_accuracy').insert({
            user_id: uid,
            event_id: String(eventId),
            event_type: event.type || event.category || null,
            pred: event.pred,
            actual: submittedForm.actual,
            was_correct: wasCorrect,
          }).then(({ error }) => {
            if (error) console.error('寫入預測準確率失敗:', error)
          })
        })
      }

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
