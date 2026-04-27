// 全域 fetch 攔截器：自動為所有發往「持倉看板 18 支 Edge Function」的請求做前端 schema 驗證
// 這樣即便呼叫點仍用 supabase.functions.invoke() 或裸 fetch，使用者也能在「請求送出前」
// 看到 toast + console.error，與 callEdge() 行為一致。
//
// 觸發時機：main.tsx 啟動時呼叫 installEdgeFetchInterceptor() 一次。

import { toast } from 'sonner'
import { EDGE_SCHEMAS } from './edgeSchemas.js'

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

function validateField(key, spec, source) {
  const direct = source?.[key]
  const alt = spec.altKey ? source?.[spec.altKey] : undefined
  const value = direct !== undefined ? direct : alt
  const issues = []
  const status = describeType(value, spec.type)
  const label = spec.label || key
  if (status === 'missing') {
    if (spec.required) issues.push({ key, label, reason: '缺少必填欄位' })
    return issues
  }
  if (status === 'wrong-type') {
    issues.push({ key, label, reason: `型別錯誤（需要 ${spec.type}）` })
    return issues
  }
  if (spec.type === 'string' && spec.minLength != null && value.trim().length < spec.minLength) {
    issues.push({ key, label, reason: `長度需 ≥ ${spec.minLength}` })
  }
  if (spec.type === 'array' && spec.minItems != null && value.length < spec.minItems) {
    issues.push({ key, label, reason: `至少 ${spec.minItems} 筆` })
  }
  if (spec.type === 'string' && spec.pattern && !spec.pattern.test(value)) {
    issues.push({ key, label, reason: '格式不正確' })
  }
  if (spec.oneOf && !spec.oneOf.includes(value)) {
    issues.push({ key, label, reason: `值需為 ${spec.oneOf.join(' / ')}` })
  }
  if (spec.type === 'object' && spec.nested) {
    for (const [nKey, nSpec] of Object.entries(spec.nested)) {
      issues.push(...validateField(nKey, nSpec, value))
    }
  }
  return issues
}

function validatePayload(fnName, schema, { body, query }) {
  let fieldSchema = null
  if (schema.actions) {
    const action = (body && body.action) || (query && query.action)
    if (!action) return [{ key: 'action', label: 'action', reason: '缺少必填欄位' }]
    fieldSchema = schema.actions[action]
    if (!fieldSchema) {
      const allowed = Object.keys(schema.actions).join(' / ')
      return [{ key: 'action', label: 'action', reason: `值需為 ${allowed}（收到 ${action}）` }]
    }
  } else if (schema.method === 'GET') {
    fieldSchema = schema.query || {}
  } else if (schema.method === 'POST') {
    fieldSchema = schema.body || {}
  } else if (schema.method === 'BOTH') {
    fieldSchema = body ? (schema.body || schema.actions ? {} : {}) : (schema.get || {})
  }
  const source = body || query || {}
  const issues = []
  for (const [key, spec] of Object.entries(fieldSchema || {})) {
    issues.push(...validateField(key, spec, source))
  }
  return issues
}

// 從 Request init / Request 物件中萃取 fnName / body / query
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
  // 過濾 host：只攔截 supabase functions
  if (!/\/functions\/v1\//.test(urlStr)) return null
  let urlObj
  try { urlObj = new URL(urlStr, typeof window !== 'undefined' ? window.location.origin : 'http://localhost') }
  catch { return null }
  const m = urlObj.pathname.match(/\/functions\/v1\/([^/?#]+)/)
  if (!m) return null
  const fnName = m[1]
  if (!EDGE_SCHEMAS[fnName]) return null
  // query
  const query = {}
  urlObj.searchParams.forEach((v, k) => { query[k] = v })
  // body
  let body = null
  if (typeof bodyRaw === 'string') {
    try { body = JSON.parse(bodyRaw) } catch { body = null }
  } else if (bodyRaw && typeof bodyRaw === 'object' && !(bodyRaw instanceof FormData) && !(bodyRaw instanceof Blob)) {
    // supabase.functions.invoke 內部會 stringify，但保險起見
    try { body = JSON.parse(JSON.stringify(bodyRaw)) } catch { body = null }
  }
  return { fnName, method: method.toUpperCase(), body, query }
}

function showToast(fnName, fields) {
  const lines = fields.map((f) => `• ${f.label}：${f.reason}`).join('\n')
  toast.error(`參數錯誤 — ${fnName}`, { description: lines })
  console.error(`[edgeFetch][${fnName}] validation failed`, fields)
}

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
        // 對於只支援 BOTH 的，根據實際 method 判斷使用哪份 schema
        const issues = validatePayload(meta.fnName, schema, {
          body: meta.method !== 'GET' ? meta.body : null,
          query: meta.method === 'GET' ? meta.query : (Object.keys(meta.query).length ? meta.query : null),
        })
        if (issues.length > 0) {
          showToast(meta.fnName, issues)
          // 模擬 400 Response，避免呼叫端 throw 出未預期錯誤
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
      }
    } catch (err) {
      console.warn('[edgeFetchInterceptor] internal error, fall through', err)
    }
    return originalFetch(input, init)
  }
}
