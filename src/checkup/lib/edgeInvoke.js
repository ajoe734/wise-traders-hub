// 統一的 Edge Function 呼叫入口：
//   1. 先做「自動轉型 (coerce)」把 stocks/codes/symbols 標準化
//   2. 用 EDGE_SCHEMAS 在 client-side 把缺值/格式錯誤擋下來（toast + throw）
//   3. 包成 fetch，補上 Authorization、CORS、JSON parse
//   4. 後端回 4xx 時把 fields/error 翻成可讀 toast（含期待格式範例 + 跳到欄位按鈕）
//
// 使用方式：
//   import { callEdge } from '@/checkup/lib/edgeInvoke'
//   const data = await callEdge('checkup-analyze', { body: { userPrompt: '...' } })
//   const data = await callEdge('checkup-twse', { query: { ex_ch: 'tse_2330.tw' } })

import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { EDGE_SCHEMAS } from './edgeSchemas.js'
import { applyCoercion } from './edgeCoerce.js'
import { showValidationToast, showCoerceToast } from './edgeFieldUI.js'

const SUPABASE_URL = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL || '' : ''
const ANON_KEY = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || '' : ''

export class EdgeValidationError extends Error {
  constructor(fnName, fields) {
    super(`[${fnName}] 參數驗證失敗：${fields.map((f) => f.label || f.key).join('、')}`)
    this.name = 'EdgeValidationError'
    this.fnName = fnName
    this.fields = fields
  }
}

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
  // acceptTypes 用於「coerce 之前」放寬型別檢查；coerce 之後仍會走主 type
  const main = describeType(value, spec.type)
  if (main === 'ok') return true
  if (spec.acceptTypes && Array.isArray(spec.acceptTypes)) {
    for (const t of spec.acceptTypes) {
      if (describeType(value, t) === 'ok') return true
    }
  }
  return false
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

function buildIssue(key, label, reason, spec) {
  return {
    key,
    label,
    reason,
    example: spec?.example,
    hint: spec?.hint,
  }
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
    fieldSchema = body ? (schema.body || {}) : (schema.get || {})
  }

  const source = body || query || {}
  const issues = []
  for (const [key, spec] of Object.entries(fieldSchema)) {
    issues.push(...validateField(key, spec, source))
  }
  return issues
}

function getFieldSchema(fnName, schema, { body, query }) {
  if (schema.actions) {
    const action = (body && body.action) || (query && query.action)
    return schema.actions?.[action] || null
  }
  if (schema.method === 'GET') return schema.query || null
  if (schema.method === 'POST') return schema.body || null
  if (schema.method === 'BOTH') return body ? (schema.body || null) : (schema.get || null)
  return null
}

// focusField / showValidationToast / showCoerceToast 已抽出到 edgeFieldUI.js

function buildUrl(fnName, query) {
  let url = `${SUPABASE_URL}/functions/v1/${fnName}`
  if (query && Object.keys(query).length > 0) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
    }
    const qsStr = qs.toString()
    if (qsStr) url += `?${qsStr}`
  }
  return url
}

async function getAuthHeader() {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    return token ? `Bearer ${token}` : `Bearer ${ANON_KEY}`
  } catch {
    return `Bearer ${ANON_KEY}`
  }
}

/**
 * 統一 Edge Function 呼叫
 * @param {string} fnName 例如 'checkup-analyze'
 * @param {{body?: object, query?: object, signal?: AbortSignal, silent?: boolean}} opts
 *   silent: true 時驗證失敗只 throw，不彈 toast（適合背景同步）
 */
export async function callEdge(fnName, opts = {}) {
  const schema = EDGE_SCHEMAS[fnName]
  if (!schema) throw new Error(`[edgeInvoke] 未註冊的 function: ${fnName}`)

  let { body, query, signal, silent } = opts

  // ── 自動轉型 (coerce) ──────────────────────────────────
  const fieldSchema = getFieldSchema(fnName, schema, { body, query })
  if (fieldSchema) {
    if (body) {
      const { source: nextBody, fixes } = applyCoercion(fieldSchema, body)
      body = nextBody
      if (fixes.length > 0 && !silent) showCoerceToast(fnName, fixes)
    }
    if (query) {
      const { source: nextQuery, fixes } = applyCoercion(fieldSchema, query)
      query = nextQuery
      if (fixes.length > 0 && !silent) showCoerceToast(fnName, fixes)
    }
  }

  // ── 前端驗證 ────────────────────────────────────────────
  const issues = validatePayload(fnName, schema, { body, query })
  if (issues.length > 0) {
    if (!silent) showValidationToast(fnName, issues)
    throw new EdgeValidationError(fnName, issues)
  }

  // ── 發 request ─────────────────────────────────────────
  const url = buildUrl(fnName, query)
  const auth = await getAuthHeader()
  const init = {
    method: schema.method === 'BOTH' ? (body ? 'POST' : 'GET') : schema.method,
    headers: {
      Authorization: auth,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    signal,
  }
  if (body) init.body = JSON.stringify(body)

  let res
  try {
    res = await fetch(url, init)
  } catch (err) {
    if (!silent) toast.error(`網路錯誤 — ${fnName}`, { description: err?.message || '無法連線' })
    throw err
  }

  let json = null
  let text = ''
  try {
    text = await res.text()
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!res.ok) {
    if (res.status === 400 && json?.error === 'VALIDATION_ERROR' && Array.isArray(json.fields)) {
      if (!silent) showValidationToast(fnName, json.fields)
      throw new EdgeValidationError(fnName, json.fields)
    }
    const msg = json?.error || json?.detail || text || `HTTP ${res.status}`
    if (!silent) toast.error(`${fnName} 失敗 (${res.status})`, { description: String(msg).slice(0, 200) })
    const err = new Error(`[${fnName}] ${msg}`)
    err.status = res.status
    err.body = json
    throw err
  }

  return json
}
