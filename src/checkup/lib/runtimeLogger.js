const RUNTIME_DIAGNOSTICS_KEY = 'pf-runtime-diagnostics-v1'
const RUNTIME_DIAGNOSTIC_LIMIT = 20
const RUNTIME_DIAGNOSTICS_BOOTSTRAP_KEY = '__PORTFOLIO_RUNTIME_DIAGNOSTICS_BOOTSTRAPPED__'
const RUNTIME_DIAGNOSTIC_REMOTE_BOOTSTRAP_KEY =
  '__PORTFOLIO_RUNTIME_DIAGNOSTIC_REMOTE_BOOTSTRAPPED__'
const RUNTIME_DIAGNOSTIC_REMOTE_SINKS_KEY = '__PORTFOLIO_RUNTIME_DIAGNOSTIC_REMOTE_SINKS__'
const RUNTIME_DIAGNOSTIC_REMOTE_QUEUE_KEY = '__PORTFOLIO_RUNTIME_DIAGNOSTIC_REMOTE_QUEUE__'
const RUNTIME_DIAGNOSTIC_REMOTE_TIMER_KEY = '__PORTFOLIO_RUNTIME_DIAGNOSTIC_REMOTE_TIMER__'
const RUNTIME_DIAGNOSTIC_REMOTE_SENTRY_WARNED_KEY =
  '__PORTFOLIO_RUNTIME_DIAGNOSTIC_REMOTE_SENTRY_WARNED__'
const WEB_VITALS_BOOTSTRAP_KEY = '__PORTFOLIO_WEB_VITALS_BOOTSTRAPPED__'

const DEFAULT_REMOTE_SAMPLE_RATE = 1
const DEFAULT_REMOTE_FLUSH_INTERVAL_MS = 3000
const DEFAULT_REMOTE_BATCH_SIZE = 10
const DEFAULT_ANALYTICS_ENDPOINT = '/api/telemetry'

function getBrowserEnv() {
  return typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function isElementLike(value) {
  return typeof Element !== 'undefined' && value instanceof Element
}

function describeElement(value) {
  if (!isElementLike(value)) return value
  const tag = String(value.tagName || 'element').toLowerCase()
  const id = value.id ? `#${value.id}` : ''
  const className =
    typeof value.className === 'string'
      ? value.className
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((item) => `.${item}`)
          .join('')
      : ''
  return `${tag}${id}${className}`
}

function normalizeValue(value, depth = 0) {
  if (value == null) return value
  if (depth > 2) return String(value)
  if (isElementLike(value)) return describeElement(value)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || String(value),
      stack: value.stack || null,
    }
  }
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => normalizeValue(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key, normalizeValue(item, depth + 1)])
    )
  }
  return String(value)
}

function serializeError(error) {
  const normalized = normalizeValue(error)
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) return normalized
  return {
    name: typeof error?.name === 'string' ? error.name : 'UnknownError',
    message: typeof normalized === 'string' ? normalized : String(error ?? 'Unknown error'),
    stack: typeof error?.stack === 'string' ? error.stack : null,
  }
}

function getWindowConfig() {
  if (typeof window === 'undefined') return {}
  return window.__PORTFOLIO_RUNTIME_MONITORING__ || {}
}

export function getRuntimeMonitoringConfig() {
  const env = getBrowserEnv()
  const windowConfig = getWindowConfig()

  const analyticsConfig = windowConfig.analytics || {}
  const sentryConfig = windowConfig.sentry || {}
  const queueConfig = windowConfig.queue || {}

  const sampleRate = clamp(
    normalizeNumber(
      windowConfig.sampleRate ?? env.VITE_RUNTIME_DIAGNOSTICS_SAMPLE_RATE,
      DEFAULT_REMOTE_SAMPLE_RATE
    ),
    0,
    1
  )

  const analyticsEnabled = normalizeBoolean(
    analyticsConfig.enabled ?? env.VITE_RUNTIME_ANALYTICS_ENABLED,
    false
  )
  const sentryEnabled = normalizeBoolean(
    sentryConfig.enabled ?? env.VITE_RUNTIME_SENTRY_ENABLED,
    false
  )

  return {
    sampleRate,
    enabled: analyticsEnabled || sentryEnabled,
    analytics: {
      enabled: analyticsEnabled,
      endpoint: String(
        analyticsConfig.endpoint ||
          env.VITE_RUNTIME_ANALYTICS_ENDPOINT ||
          DEFAULT_ANALYTICS_ENDPOINT
      ),
      headers:
        analyticsConfig.headers && typeof analyticsConfig.headers === 'object'
          ? analyticsConfig.headers
          : {},
    },
    sentry: {
      enabled: sentryEnabled,
      captureWebVitals: normalizeBoolean(sentryConfig.captureWebVitals, true),
      useGlobal: normalizeBoolean(sentryConfig.useGlobal, true),
      client: sentryConfig.client || null,
      tags: sentryConfig.tags && typeof sentryConfig.tags === 'object' ? sentryConfig.tags : {},
    },
    queue: {
      flushIntervalMs: Math.max(
        250,
        normalizeNumber(
          queueConfig.flushIntervalMs ?? env.VITE_RUNTIME_DIAGNOSTICS_FLUSH_INTERVAL_MS,
          DEFAULT_REMOTE_FLUSH_INTERVAL_MS
        )
      ),
      batchSize: Math.max(
        1,
        normalizeNumber(
          queueConfig.batchSize ?? env.VITE_RUNTIME_DIAGNOSTICS_BATCH_SIZE,
          DEFAULT_REMOTE_BATCH_SIZE
        )
      ),
    },
  }
}

export function readClientDiagnostics() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(RUNTIME_DIAGNOSTICS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeClientDiagnostics(entries) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(entries))
  } catch {
    /* best-effort local diagnostics */
  }
  window.__PORTFOLIO_RUNTIME_DIAGNOSTICS__ = entries
}

function getRuntimeDiagnosticQueue() {
  if (typeof window === 'undefined') return []
  if (!Array.isArray(window[RUNTIME_DIAGNOSTIC_REMOTE_QUEUE_KEY])) {
    window[RUNTIME_DIAGNOSTIC_REMOTE_QUEUE_KEY] = []
  }
  return window[RUNTIME_DIAGNOSTIC_REMOTE_QUEUE_KEY]
}

function getRuntimeDiagnosticRemoteSinks() {
  if (typeof window === 'undefined') return []
  if (!Array.isArray(window[RUNTIME_DIAGNOSTIC_REMOTE_SINKS_KEY])) {
    window[RUNTIME_DIAGNOSTIC_REMOTE_SINKS_KEY] = []
  }
  return window[RUNTIME_DIAGNOSTIC_REMOTE_SINKS_KEY]
}

function clearRuntimeDiagnosticFlushTimer() {
  if (typeof window === 'undefined') return
  if (window[RUNTIME_DIAGNOSTIC_REMOTE_TIMER_KEY]) {
    window.clearTimeout(window[RUNTIME_DIAGNOSTIC_REMOTE_TIMER_KEY])
    window[RUNTIME_DIAGNOSTIC_REMOTE_TIMER_KEY] = null
  }
}

function scheduleRuntimeDiagnosticFlush(delayMs) {
  if (typeof window === 'undefined') return
  if (window[RUNTIME_DIAGNOSTIC_REMOTE_TIMER_KEY]) return
  window[RUNTIME_DIAGNOSTIC_REMOTE_TIMER_KEY] = window.setTimeout(() => {
    window[RUNTIME_DIAGNOSTIC_REMOTE_TIMER_KEY] = null
    void flushRuntimeDiagnosticsQueue()
  }, delayMs)
}

function shouldRemoteReport(sampleRate) {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  return Math.random() <= sampleRate
}

export function registerRuntimeDiagnosticsSink(sink) {
  if (typeof window === 'undefined' || !sink || typeof sink.send !== 'function') return
  const sinks = getRuntimeDiagnosticRemoteSinks()
  if (!sinks.includes(sink)) sinks.push(sink)
}

export function clearRuntimeDiagnosticsSinks() {
  if (typeof window === 'undefined') return
  window[RUNTIME_DIAGNOSTIC_REMOTE_SINKS_KEY] = []
}

export function createAnalyticsHttpSink(options = {}) {
  const { endpoint = DEFAULT_ANALYTICS_ENDPOINT, headers = {} } = options

  return {
    name: 'analytics-http',
    async send(entries) {
      if (!Array.isArray(entries) || entries.length === 0) return { ok: true, accepted: 0 }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        keepalive: true,
        body: JSON.stringify({
          action: 'capture-diagnostics',
          data: {
            source: 'client-runtime',
            entries,
          },
        }),
      })
      if (!response.ok) {
        throw new Error(`analytics sink failed (${response.status})`)
      }
      try {
        return await response.json()
      } catch {
        return { ok: true, accepted: entries.length }
      }
    },
  }
}

function applySentryScope(scope, entry, tags = {}) {
  if (!scope) return
  if (typeof scope.setLevel === 'function') scope.setLevel(entry.level || 'error')
  if (typeof scope.setTag === 'function') {
    scope.setTag('diagnostic.kind', entry.kind)
    Object.entries(tags).forEach(([key, value]) => {
      scope.setTag(key, String(value))
    })
  }
  if (typeof scope.setContext === 'function') {
    scope.setContext('runtime_diagnostic', {
      id: entry.id,
      kind: entry.kind,
      timestamp: entry.timestamp,
      context: entry.context,
    })
  }
  if (typeof scope.setExtra === 'function') {
    scope.setExtra('diagnostic_id', entry.id)
  }
}

function captureEntryWithSentry(client, entry, options = {}) {
  const runner =
    typeof client?.withScope === 'function'
      ? client.withScope.bind(client)
      : (callback) => callback(null)
  runner((scope) => {
    applySentryScope(scope, entry, options.tags || {})
    const error = new Error(entry?.error?.message || 'Runtime diagnostic')
    error.name = entry?.error?.name || 'RuntimeDiagnosticError'
    if (entry?.error?.stack) error.stack = entry.error.stack

    if (entry.kind === 'web-vital') {
      if (typeof client.captureMessage === 'function') {
        client.captureMessage(
          `[web-vital] ${entry?.context?.metric?.name || 'metric'} ${entry?.context?.metric?.rating || ''}`.trim(),
          entry.level || 'warning'
        )
      }
      return
    }

    if (typeof client.captureException === 'function') {
      client.captureException(error)
    } else if (typeof client.captureMessage === 'function') {
      client.captureMessage(error.message, entry.level || 'error')
    }
  })
}

export function createSentrySink(options = {}) {
  return {
    name: 'sentry',
    async send(entries) {
      if (!Array.isArray(entries) || entries.length === 0) return { ok: true, accepted: 0 }
      const client =
        options.client ||
        (options.useGlobal !== false && typeof window !== 'undefined' ? window.Sentry : null)
      if (!client) {
        if (typeof window !== 'undefined' && !window[RUNTIME_DIAGNOSTIC_REMOTE_SENTRY_WARNED_KEY]) {
          window[RUNTIME_DIAGNOSTIC_REMOTE_SENTRY_WARNED_KEY] = true
          console.warn('[runtime:sentry] sink enabled but window.Sentry is not available.')
        }
        return { ok: true, accepted: 0, skipped: entries.length }
      }

      entries.forEach((entry) => {
        if (entry.kind === 'web-vital' && options.captureWebVitals === false) return
        captureEntryWithSentry(client, entry, options)
      })
      return { ok: true, accepted: entries.length }
    },
  }
}

export async function flushRuntimeDiagnosticsQueue() {
  if (typeof window === 'undefined') return []
  clearRuntimeDiagnosticFlushTimer()

  const sinks = getRuntimeDiagnosticRemoteSinks()
  const queue = getRuntimeDiagnosticQueue()
  if (sinks.length === 0 || queue.length === 0) return []

  const config = getRuntimeMonitoringConfig()
  const batch = queue.splice(0, config.queue.batchSize)

  const results = await Promise.allSettled(sinks.map((sink) => sink.send(batch)))

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `[runtime:sink:${sinks[index]?.name || index}]`,
        result.reason?.message || result.reason || 'send failed'
      )
    }
  })

  if (queue.length > 0) {
    scheduleRuntimeDiagnosticFlush(config.queue.flushIntervalMs)
  }

  return batch
}

function enqueueRuntimeDiagnosticForRemote(entry) {
  if (typeof window === 'undefined') return
  const sinks = getRuntimeDiagnosticRemoteSinks()
  const config = getRuntimeMonitoringConfig()
  if (!config.enabled || sinks.length === 0) return
  if (!shouldRemoteReport(config.sampleRate)) return

  const queue = getRuntimeDiagnosticQueue()
  queue.push(entry)
  scheduleRuntimeDiagnosticFlush(config.queue.flushIntervalMs)
}

function bootstrapRuntimeDiagnosticRemoteSinks() {
  if (typeof window === 'undefined') return
  if (window[RUNTIME_DIAGNOSTIC_REMOTE_BOOTSTRAP_KEY]) return
  window[RUNTIME_DIAGNOSTIC_REMOTE_BOOTSTRAP_KEY] = true

  const config = getRuntimeMonitoringConfig()
  if (config.analytics.enabled) {
    registerRuntimeDiagnosticsSink(createAnalyticsHttpSink(config.analytics))
  }
  if (config.sentry.enabled) {
    registerRuntimeDiagnosticsSink(createSentrySink(config.sentry))
  }
}

export function captureClientDiagnostic(kind, error, context = {}, options = {}) {
  const { emitConsole = true, level = 'error' } = options
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: String(kind || 'runtime-error'),
    timestamp: new Date().toISOString(),
    level,
    error: serializeError(error),
    context: normalizeValue(context),
  }

  if (typeof window !== 'undefined') {
    const entries = [entry, ...readClientDiagnostics()].slice(0, RUNTIME_DIAGNOSTIC_LIMIT)
    writeClientDiagnostics(entries)
    enqueueRuntimeDiagnosticForRemote(entry)
  }

  if (emitConsole && level === 'warn') {
    console.warn(`[runtime:${entry.kind}]`, entry)
  } else if (emitConsole && level === 'error') {
    console.error(`[runtime:${entry.kind}]`, entry)
  }
  return entry
}

export function captureWebVitalMetric(metric) {
  if (!metric || typeof metric !== 'object') return null
  const metricName = String(metric.name || 'unknown')
  return captureClientDiagnostic(
    'web-vital',
    {
      name: 'WebVitalMetric',
      message: `${metricName} ${metric.rating || 'measured'} (${metric.value})`,
    },
    {
      metric: {
        name: metricName,
        value: metric.value,
        delta: metric.delta,
        rating: metric.rating || null,
        id: metric.id || null,
        navigationType: metric.navigationType || null,
      },
      attribution: normalizeValue(metric.attribution || {}),
    },
    { emitConsole: false, level: 'warn' }
  )
}

async function startWebVitalsTracking() {
  if (typeof window === 'undefined') return
  if (window[WEB_VITALS_BOOTSTRAP_KEY]) return
  window[WEB_VITALS_BOOTSTRAP_KEY] = true

  try {
    const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals/attribution')

    ;[onCLS, onFCP, onINP, onLCP, onTTFB].forEach((registerMetric) => {
      registerMetric((metric) => {
        captureWebVitalMetric(metric)
      })
    })
  } catch (error) {
    captureClientDiagnostic('web-vitals-bootstrap-error', error, {}, { level: 'warn' })
  }
}

function scheduleWebVitalsTracking() {
  if (typeof window === 'undefined') return
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(
      () => {
        void startWebVitalsTracking()
      },
      { timeout: 2000 }
    )
    return
  }
  window.setTimeout(() => {
    void startWebVitalsTracking()
  }, 0)
}

function flushRuntimeDiagnosticsSoon() {
  void flushRuntimeDiagnosticsQueue()
}

export function resetRuntimeDiagnosticsState() {
  if (typeof window === 'undefined') return
  clearRuntimeDiagnosticFlushTimer()
  window[RUNTIME_DIAGNOSTICS_BOOTSTRAP_KEY] = false
  window[RUNTIME_DIAGNOSTIC_REMOTE_BOOTSTRAP_KEY] = false
  window[WEB_VITALS_BOOTSTRAP_KEY] = false
  window[RUNTIME_DIAGNOSTIC_REMOTE_SENTRY_WARNED_KEY] = false
  window[RUNTIME_DIAGNOSTIC_REMOTE_QUEUE_KEY] = []
  window[RUNTIME_DIAGNOSTIC_REMOTE_SINKS_KEY] = []
  window.__PORTFOLIO_RUNTIME_DIAGNOSTICS__ = []
  try {
    window.sessionStorage.removeItem(RUNTIME_DIAGNOSTICS_KEY)
  } catch {
    /* ignore test reset failures */
  }
}

export function bootstrapRuntimeDiagnostics() {
  if (typeof window === 'undefined') return
  if (window[RUNTIME_DIAGNOSTICS_BOOTSTRAP_KEY]) return
  window[RUNTIME_DIAGNOSTICS_BOOTSTRAP_KEY] = true

  bootstrapRuntimeDiagnosticRemoteSinks()

  window.addEventListener('error', (event) => {
    captureClientDiagnostic('window-error', event.error || event.message, {
      filename: event.filename || null,
      lineno: event.lineno || null,
      colno: event.colno || null,
    })
    event.preventDefault()
  })

  window.addEventListener('unhandledrejection', (event) => {
    captureClientDiagnostic('unhandled-rejection', event.reason, {})
    event.preventDefault()
  })

  window.addEventListener('pagehide', flushRuntimeDiagnosticsSoon)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushRuntimeDiagnosticsSoon()
    }
  })

  scheduleWebVitalsTracking()
}
