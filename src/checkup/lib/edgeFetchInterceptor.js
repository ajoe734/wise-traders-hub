// 全域 fetch 攔截器：
// 1) 自動 coerce「stocks/codes/symbols」等欄位（接受字串或陣列），會改寫 init.body
// 2) 對所有發往「持倉看板 18 支 Edge Function」的請求做前端 schema 驗證
// 觸發時機：main.tsx 啟動時呼叫 installEdgeFetchInterceptor() 一次。

import { EDGE_SCHEMAS } from './edgeSchemas.js'
import { applyCoercion } from './edgeCoerce.js'
import { showValidationToast, showCoerceToast } from './edgeFieldUI.js'

let installed = false

function describeType(value, type) {
  if (value === undefined || value === null || value === '') return 'missing'
  if (type === 'array') return Array.isArray(value) ? 'ok' : 'wrong-type'
  if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value) ? 'ok' : 'wrong-type'
  if (type === 'string') return typeof value === 'string' ? 'ok' : 'wrong-type'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? 'ok' : 'wrong-type'
  if (type === 'boolean') return typeof value === 'boolean' ? 'ok' : 'wrong-type'
  if (type === 'any') return 'ok'
  return 'ok'
}

function typeMatches(value, spec) {
  if (describeType(value, spec.type) === 'ok') return true
  if (Array.isArray(spec.acceptTypes)) {
    for (const t of spec.acceptTypes) if (describeType(value, t) === 'ok') return true
  }
  return false
}

function buildIssue(key, label, reason, spec) {
  return { key, label, reason, example: spec?.example, hint: spec?.hint }
}

function validateField(key, spec, source) {
  const direct = source?.[key]
  const alt = spec.altKey ? source?.[spec.altKey] : undefined
  const value = direct !== undefined ? direct : alt
  const issues = []
  const label = spec.label || key
  const status = describeType(value, spec.type)
  if (status === 'missing') {
    if (spec.required) issues.push(buildIssue(key, label, '缺少必填欄位', spec))
    return issues
  }
  if (status === 'wrong-type' && !typeMatches(value, spec)) {
    issues.push(buildIssue(key, label, `型別錯誤（需要 ${spec.type}）`, spec))
    return issues
  }
  if (spec.type === 'string' && spec.minLength != null && (value?.trim?.().length || 0) < spec.minLength) {
    issues.push(buildIssue(key, label, `長度需 ≥ ${spec.minLength}`, spec))
  }
  if (spec.type === 'array' && spec.minItems != null && Array.isArray(value) && value.length < spec.minItems) {
    issues.push(buildIssue(key, label, `至少 ${spec.minItems} 筆`, spec))
  }
  if (spec.type === 'string' && spec.pattern && typeof value === 'string' && !spec.pattern.test(value)) {
    issues.push(buildIssue(key, label, '格式不正確', spec))
  }
  if (spec.oneOf && !spec.oneOf.includes(value)) {
    issues.push(buildIssue(key, label, `值需為 ${spec.oneOf.join(' / ')}`, spec))
  }
  if (spec.type === 'object' && spec.nested) {
    for (const [nKey, nSpec] of Object.entries(spec.nested)) {
      issues.push(...validateField(nKey, nSpec, value))
    }
  }
  return issues
}

function getFieldSchema(schema, body, query) {
  if (schema.actions) {
    const action = (body && body.action) || (query && query.action)
    return schema.actions?.[action] || null
  }
  if (schema.method === 'GET') return schema.query || null
  if (schema.method === 'POST') return schema.body || null
  if (schema.method === 'BOTH') return body ? (schema.body || null) : (schema.get || null)
  return null
}

function validatePayload(fnName, schema, { body, query }) {
  if (schema.actions) {
    const action = (body && body.action) || (query && query.action)
    if (!action) return [{ key: 'action', label: 'action', reason: '缺少必填欄位' }]
    const fs = schema.actions[action]
    if (!fs) {
      const allowed = Object.keys(schema.actions).join(' / ')
      return [{ key: 'action', label: 'action', reason: `值需為 ${allowed}（收到 ${action}）` }]
    }
    const source = body || query || {}
    const issues = []
    for (const [k, s] of Object.entries(fs)) issues.push(...validateField(k, s, source))
    return issues
  }
  const fs = getFieldSchema(schema, body, query) || {}
  const source = body || query || {}
  const issues = []
  for (const [k, s] of Object.entries(fs)) issues.push(...validateField(k, s, source))
  return issues
}

function extractEdgeRequest(input, init) {
  let urlStr = ''
  let method = 'GET'
  let bodyRaw = null
  if (typeof input === 'string') {
    urlStr = input
  } else if (input instanceof URL) {
    urlStr = input.toString()
  } else if (input && typeof input === 'object' && 'url' in input) {
    urlStr = input.url
    method = input.method || method
  }
  if (init?.method) method = init.method
  if (init?.body != null) bodyRaw = init.body
  if (!/\/functions\/v1\//.test(urlStr)) return null
  let urlObj
  try { urlObj = new URL(urlStr, typeof window !== 'undefined' ? window.location.origin : 'http://localhost') }
  catch { return null }
  const m = urlObj.pathname.match(/\/functions\/v1\/([^/?#]+)/)
  if (!m) return null
  const fnName = m[1]
  if (!EDGE_SCHEMAS[fnName]) return null
  const query = {}
  urlObj.searchParams.forEach((v, k) => { query[k] = v })
  let body = null
  if (typeof bodyRaw === 'string') {
    try { body = JSON.parse(bodyRaw) } catch { body = null }
  } else if (bodyRaw && typeof bodyRaw === 'object' && !(bodyRaw instanceof FormData) && !(bodyRaw instanceof Blob)) {
    try { body = JSON.parse(JSON.stringify(bodyRaw)) } catch { body = null }
  }
  return { fnName, method: method.toUpperCase(), body, query, urlStr }
}

// focusField / showValidationToast / showCoerceToast 已抽出到 edgeFieldUI.js

export function installEdgeFetchInterceptor() {
  if (installed) return
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = async function patchedFetch(input, init) {
    try {
      const meta = extractEdgeRequest(input, init)
      if (meta) {
        const schema = EDGE_SCHEMAS[meta.fnName]
        const isPost = meta.method !== 'GET'
        const body = isPost ? meta.body : null
        const query = isPost ? null : (Object.keys(meta.query).length ? meta.query : null)

        // ── 1) 自動轉型 ────────────────────────────────
        const fieldSchema = getFieldSchema(schema, body, query)
        let mutatedBody = body
        let mutatedQuery = query
        if (fieldSchema) {
          const allFixes = []
          if (body) {
            const { source: nb, fixes } = applyCoercion(fieldSchema, body)
            mutatedBody = nb
            allFixes.push(...fixes)
          }
          if (query) {
            const { source: nq, fixes } = applyCoercion(fieldSchema, query)
            mutatedQuery = nq
            allFixes.push(...fixes)
          }
          if (allFixes.length > 0) showCoerceToast(meta.fnName, allFixes)
        }

        // ── 2) 驗證 ────────────────────────────────────
        const issues = validatePayload(meta.fnName, schema, { body: mutatedBody, query: mutatedQuery })
        if (issues.length > 0) {
          showValidationToast(meta.fnName, issues)
          const fakeBody = JSON.stringify({
            error: 'VALIDATION_ERROR',
            message: `前端攔截：${issues.map((f) => f.label).join('、')}`,
            fields: issues,
            interceptedBy: 'edgeFetchInterceptor',
          })
          return new Response(fakeBody, {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // ── 3) 把 coerce 後的 body 寫回 init ──────────
        if (isPost && mutatedBody !== body && mutatedBody) {
          init = { ...(init || {}), body: JSON.stringify(mutatedBody) }
        }
      }
    } catch (err) {
      console.warn('[edgeFetchInterceptor] internal error, fall through', err)
    }
    return originalFetch(input, init)
  }
}
