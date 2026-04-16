/**
 * Holding Event / Decision Utils — Decision System v6
 *
 * HARD RULES (violations are bugs):
 *   R1  Never use event.status directly to judge open/closed.
 *       Always go through isEventOpen() or getEffectiveStatus().
 *   R2  buildDecisionFingerprint() sorts by occurredAt ASC then id ASC.
 *   R3  mergeEvents() is the single merge implementation.
 *       Keep existing.id, latest summary/evidence, max severity,
 *       flag _hasMergeConflict on impact clash.
 *   R4  category / impact / severity / occurredAt are immutable after creation.
 *       Corrections must create a new event and resolve the old one.
 *       validateEventMutation() enforces this.
 *   R5  effectiveUntil expiry never writes back to status.
 *       expired is computed at read time via getEffectiveStatus().
 */

import { FRESHNESS_RULES, ACTION_TEMPLATES, IMMUTABLE_EVENT_FIELDS } from '../constants.js'

// ── Severity ordering ────────────────────────────────────────────
const SEV_ORDER = { high: 3, medium: 2, low: 1 }
const maxSeverity = (a, b) => (SEV_ORDER[a] || 0) >= (SEV_ORDER[b] || 0) ? a : b

// ── R1 + R5: Status helpers ──────────────────────────────────────

/**
 * The ONLY function to derive effective status (R1, R5).
 * Never read event.status directly elsewhere.
 */
export function getEffectiveStatus(event, now = new Date()) {
  if (!event) return 'resolved'
  // Already explicitly resolved
  if (event.decisionStatus === 'resolved' || event.resolvedAt) return 'resolved'
  // R5: expired is computed, never written
  if (event.effectiveUntil) {
    const until = new Date(event.effectiveUntil)
    if (!isNaN(until.getTime()) && until < now) return 'expired'
  }
  return 'open'
}

export function isEventOpen(event, now = new Date()) {
  return getEffectiveStatus(event, now) === 'open'
}

/**
 * UI adapter: maps v6 status to legacy display values
 * for calendar / event-analysis tabs that still read status.
 */
export function toLegacyDisplayStatus(event, now = new Date()) {
  const effective = getEffectiveStatus(event, now)
  if (effective === 'open') return event.status === 'tracking' ? 'tracking' : 'pending'
  return 'closed'
}

// ── Freshness ────────────────────────────────────────────────────

export function deriveFreshness(event, now = new Date()) {
  if (!event?.occurredAt) return 'stale'
  const rules = FRESHNESS_RULES[event.category] || FRESHNESS_RULES.catalyst
  const daysSince = (now - new Date(event.occurredAt)) / 86400000
  if (daysSince <= rules.agingDays) return 'fresh'
  if (daysSince <= rules.staleDays) return 'aging'
  return 'stale'
}

// ── Thesis / Position / Urgency derivation ───────────────────────

export function deriveThesisState(openEvents) {
  if (!openEvents || openEvents.length === 0) return 'intact'
  const getImpact = e => e.decisionImpact || e.impact
  const hasBreak = openEvents.some(e => getImpact(e) === 'break')
  if (hasBreak) return 'broken'
  const hasWeaken = openEvents.some(e => getImpact(e) === 'weaken')
  if (hasWeaken) return 'weakening'
  return 'intact'
}

export function derivePositionState(thesisState) {
  if (thesisState === 'broken') return 'exit'
  if (thesisState === 'weakening') return 'warning'
  return 'holding'
}

export function deriveUrgency(positionState, openEvents, now = new Date()) {
  if (positionState === 'exit') return 'now'
  if (positionState === 'warning') {
    const hasHigh = openEvents.some(e => e.severity === 'high')
    if (hasHigh) return 'now'
    // Check reviewAt deadlines
    const hasUpcoming = openEvents.some(e => {
      if (!e.reviewAt) return false
      const diff = (new Date(e.reviewAt) - now) / 86400000
      return diff <= 3 && diff >= 0
    })
    if (hasUpcoming) return 'soon'
    return 'soon'
  }
  // holding
  const hasReviewSoon = openEvents.some(e => {
    if (!e.reviewAt) return false
    const diff = (new Date(e.reviewAt) - now) / 86400000
    return diff <= 3 && diff >= 0
  })
  if (hasReviewSoon) return 'soon'
  return 'monitor'
}

// ── Conflict detection ───────────────────────────────────────────

export function detectConflict(openEvents, override) {
  // Check impact direction clash among open events (use decisionImpact preferentially)
  const impacts = new Set(openEvents.map(e => e.decisionImpact || e.impact).filter(Boolean))
  const hasDirectionClash = (impacts.has('break') || impacts.has('weaken')) && impacts.has('strengthen')

  // Check override vs derived mismatch
  let hasOverrideMismatch = false
  if (override) {
    const thesisState = deriveThesisState(openEvents)
    const derivedPosition = derivePositionState(thesisState)
    if (override.actionType && override.actionType !== derivedPosition) {
      // e.g. user says "hold" but system says "exit"
      hasOverrideMismatch = derivedPosition !== 'holding' || override.actionType !== 'hold'
    }
  }

  return hasDirectionClash || hasOverrideMismatch
}

// ── Confidence ───────────────────────────────────────────────────

export function deriveConfidence(openEvents, hasConflict, now = new Date()) {
  if (openEvents.length === 0) return 'low'

  // R4 constraints: cannot be high if…
  const allAi = openEvents.every(e => e.source === 'ai')
  const noStructuredEvidence = openEvents.every(e => !e.evidence || e.evidence.trim() === '')
  const hasMissingFields = openEvents.some(e => !e.category || !e.impact || !e.severity)
  const hasMergeConflict = openEvents.some(e => e._hasMergeConflict)

  if (allAi && noStructuredEvidence) return hasConflict ? 'low' : 'medium'
  if (hasMissingFields) return 'low'
  if (hasMergeConflict) return hasConflict ? 'low' : 'medium'
  if (hasConflict) return 'medium'

  // Check freshness
  const allFresh = openEvents.every(e => deriveFreshness(e, now) === 'fresh')
  if (allFresh) return 'high'
  const anyStale = openEvents.some(e => deriveFreshness(e, now) === 'stale')
  if (anyStale) return 'medium'
  return 'high'
}

// ── Action derivation (template-based) ───────────────────────────

export function buildAction(positionState, openEvents, override, now = new Date()) {
  // If override is active and not expired, use it
  if (override && override.actionType) {
    if (!override.expiresAt || new Date(override.expiresAt) > now) {
      return {
        actionType: override.actionType,
        actionText: override.actionText || ACTION_TEMPLATES[override.actionType]?.default || '',
      }
    }
  }

  const actionType = positionState === 'exit' ? 'exit'
    : positionState === 'warning' ? 'review'
    : 'hold'

  // Template selection
  const templates = ACTION_TEMPLATES[actionType] || {}
  let actionText = templates.default || ''

  if (actionType === 'review') {
    const earningsEvent = openEvents.find(e => e.category === 'earnings')
    if (earningsEvent) actionText = templates.earnings || actionText
    // Check for deadline
    const withReview = openEvents.find(e => e.reviewAt)
    if (withReview) {
      const days = Math.ceil((new Date(withReview.reviewAt) - now) / 86400000)
      if (days > 0) actionText = (templates.deadline || actionText).replace('{days}', days)
    }
  }

  if (actionType === 'hold') {
    const withReview = openEvents.find(e => e.reviewAt)
    if (withReview) {
      const reviewDate = new Date(withReview.reviewAt)
      const formatted = `${reviewDate.getFullYear()}/${String(reviewDate.getMonth()+1).padStart(2,'0')}/${String(reviewDate.getDate()).padStart(2,'0')}`
      actionText = (templates.with_review || actionText).replace('{reviewAt}', formatted)
    }
  }

  return { actionType, actionText }
}

// ── R2: Fingerprint ──────────────────────────────────────────────

export function buildDecisionFingerprint(openEvents) {
  if (!openEvents || openEvents.length === 0) return ''
  const sorted = [...openEvents].sort((a, b) => {
    const da = new Date(a.occurredAt || 0)
    const db = new Date(b.occurredAt || 0)
    if (da.getTime() !== db.getTime()) return da - db
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
  // Simple hash: concatenate and produce a stable string
  const raw = sorted.map(e => `${e.id}:${e.impact}`).join('|')
  // Use a simple djb2 hash for stability (no crypto needed)
  let hash = 5381
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) & 0xFFFFFFFF
  }
  return hash.toString(36)
}

// ── R3: Dedupe & Merge ───────────────────────────────────────────

export function isDuplicateEvent(existing, incoming) {
  if (!existing || !incoming) return false
  if (existing.source === 'user' || incoming.source === 'user') return false
  if (existing.category !== incoming.category) return false
  const eCodes = new Set(existing.relatedCodes || [])
  const iCodes = incoming.relatedCodes || []
  if (iCodes.length === 0 || !iCodes.some(c => eCodes.has(c))) return false
  // Within 24h window
  const eDate = new Date(existing.occurredAt || 0)
  const iDate = new Date(incoming.occurredAt || 0)
  return Math.abs(eDate - iDate) < 86400000
}

export function mergeEvents(existing, incoming) {
  if (!existing || !incoming) return existing || incoming
  const result = { ...existing }
  // Summary/evidence: take latest updatedAt
  const eUpdated = new Date(existing.updatedAt || existing.occurredAt || 0)
  const iUpdated = new Date(incoming.updatedAt || incoming.occurredAt || 0)
  if (iUpdated > eUpdated) {
    result.summary = incoming.summary || existing.summary
    result.evidence = incoming.evidence || existing.evidence
    result.updatedAt = incoming.updatedAt || new Date().toISOString()
  }
  // Severity: take higher
  result.severity = maxSeverity(existing.severity, incoming.severity)
  // Impact: if clash, flag conflict, don't overwrite
  if (existing.impact && incoming.impact && existing.impact !== incoming.impact) {
    result._hasMergeConflict = true
  }
  return result
}

// ── R4: Immutability validation ──────────────────────────────────

export function validateEventMutation(original, updates) {
  if (!original || !updates) return { valid: true, violations: [] }
  const violations = []
  for (const field of IMMUTABLE_EVENT_FIELDS) {
    if (field in updates && original[field] != null && updates[field] !== original[field]) {
      violations.push(field)
    }
  }
  return { valid: violations.length === 0, violations }
}

// ── AI event validation ──────────────────────────────────────────

export function validateAiEvent(event) {
  const required = ['category', 'impact', 'severity', 'occurredAt']
  const missing = required.filter(f => !event?.[f])
  return { valid: missing.length === 0, missing }
}

// ── Main entry: buildDecision ────────────────────────────────────

export function buildDecision(code, allEvents, userOverrides = {}, now = new Date()) {
  // Filter: only open, non-demo events for this code
  const codeEvents = (allEvents || []).filter(e => {
    if (e.source === 'demo') return false
    const codes = e.relatedCodes || []
    return codes.includes(code)
  })

  const openEvents = codeEvents.filter(e => isEventOpen(e, now))
  const override = userOverrides[code] || null

  // Check override expiry/fingerprint validity
  let effectiveOverride = null
  if (override) {
    const expired = override.expiresAt && new Date(override.expiresAt) < now
    if (!expired) effectiveOverride = override
  }

  const thesisState = deriveThesisState(openEvents)
  const positionState = derivePositionState(thesisState)
  const urgency = deriveUrgency(positionState, openEvents, now)
  const hasConflict = detectConflict(openEvents, effectiveOverride)
  const confidence = deriveConfidence(openEvents, hasConflict, now)
  const { actionType, actionText } = buildAction(positionState, openEvents, effectiveOverride, now)
  const fingerprint = buildDecisionFingerprint(openEvents)

  const decision = {
    code,
    thesisState,
    positionState,
    urgency,
    hasConflict,
    confidence,
    actionType,
    actionText,
    fingerprint,
    openEventCount: openEvents.length,
    highestSeverity: openEvents.reduce((max, e) => maxSeverity(max, e.severity || 'low'), 'low'),
    latestOccurredAt: openEvents.length > 0
      ? openEvents.reduce((latest, e) => {
          const d = new Date(e.occurredAt || 0)
          return d > latest ? d : latest
        }, new Date(0)).toISOString()
      : null,
    updatedAt: now.toISOString(),
  }

  // R6: Debug output
  if (typeof window !== 'undefined' && window.__DECISION_DEBUG) {
    decision._debug = {
      openEvents: openEvents.map(e => ({
        id: e.id, category: e.category, impact: e.impact,
        severity: e.severity, source: e.source,
        freshness: deriveFreshness(e, now),
        effectiveStatus: getEffectiveStatus(e, now),
      })),
      derivationSteps: [
        `thesisState: ${thesisState} (from ${openEvents.length} open events)`,
        `positionState: ${positionState}`,
        `urgency: ${urgency}`,
        `conflict: ${hasConflict}`,
        `confidence: ${confidence}`,
        `override: ${effectiveOverride ? effectiveOverride.actionType : 'none'}`,
      ],
      conflictSources: hasConflict ? {
        impactClash: openEvents.map(e => `${e.id}:${e.impact}`),
        overrideMismatch: effectiveOverride ? `override=${effectiveOverride.actionType} vs derived=${positionState}` : null,
      } : null,
    }
  }

  return decision
}

// ── Sorting ──────────────────────────────────────────────────────

const URGENCY_ORDER = { now: 3, soon: 2, monitor: 1 }

export function sortByDecisionPriority(decisions) {
  return [...decisions].sort((a, b) => {
    // 1. Conflict first
    if (a.hasConflict !== b.hasConflict) return a.hasConflict ? -1 : 1
    // 2. Urgency
    const ua = URGENCY_ORDER[a.urgency] || 0
    const ub = URGENCY_ORDER[b.urgency] || 0
    if (ua !== ub) return ub - ua
    // 3. Severity
    const sa = SEV_ORDER[a.highestSeverity] || 0
    const sb = SEV_ORDER[b.highestSeverity] || 0
    if (sa !== sb) return sb - sa
    // 4. updatedAt
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  })
}
