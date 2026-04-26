// 統一的 Edge Function 呼叫入口：
//   1. 用 EDGE_SCHEMAS 在 client-side 先把缺值/格式錯誤擋下來（直接 toast + throw）
//   2. 包成 fetch，補上 Authorization、CORS、JSON parse
//   3. 後端回 4xx 時把 fields/error 翻成可讀 toast
//
// 使用方式：
//   import { callEdge } from '@/checkup/lib/edgeInvoke'
//   const data = await callEdge('checkup-analyze', { body: { userPrompt: '...' } })
//   const data = await callEdge('checkup-twse', { query: { ex_ch: 'tse_2330.tw' } })

import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { EDGE_SCHEMAS } from './edgeSchemas.js'

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

function validateField(key, spec, source) {
  // 支援 altKey（例如 checkup-analyze 的 prompt = userPrompt 別名）
  const direct = source?.[key]
  const alt = spec.altKey ? source?.[spec.altKey] : undefined
  const value = direct !== undefined ? direct : alt
  const issues = []

  const status = describeType(value, spec.type)
  if (status === 'missing') {
    if (spec.required) issues.push({ key, label: spec.label || key, reason: '缺少必填欄位' })
    return issues
  }
  if (status === 'wrong-type') {
    issues.push({ key, label: spec.label || key, reason: `型別錯誤（需要 ${spec.type}）` })
    return issues
  }
  if (spec.type === 'string' && spec.minLength != null && value.trim().length < spec.minLength) {
    issues.push({ key, label: spec.label || key, reason: `長度需 ≥ ${spec.minLength}` })
  }
  if (spec.type === 'array' && spec.minItems != null && value.length < spec.minItems) {
    issues.push({ key, label: spec.label || key, reason: `至少 ${spec.minItems} 筆` })
  }
  if (spec.type === 'string' && spec.pattern && !spec.pattern.test(value)) {
    issues.push({ key, label: spec.label || key, reason: '格式不正確' })
  }
  if (spec.oneOf && !spec.oneOf.includes(value)) {
    issues.push({ key, label: spec.label || key, reason: `值需為 ${spec.oneOf.join(' / ')}` })
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
    if (!action) {
      return [{ key: 'action', label: 'action', reason: '缺少必填欄位' }]
    }
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

function showValidationToast(fnName, fields) {
  const lines = fields.map((f) => `• ${f.label}：${f.reason}`).join('\n')
  toast.error(`參數錯誤 — ${fnName}`, { description: lines })
  console.error(`[edgeInvoke][${fnName}] validation failed`, fields)
}

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
 * @returns {Promise<any>} 解析後的 JSON
 */
export async function callEdge(fnName, opts = {}) {
  const schema = EDGE_SCHEMAS[fnName]
  if (!schema) throw new Error(`[edgeInvoke] 未註冊的 function: ${fnName}`)

  const { body, query, signal, silent } = opts

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

  // 解析 body
  let json = null
  let text = ''
  try {
    text = await res.text()
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  // ── 4xx：把 server 的 VALIDATION_ERROR 翻譯成 toast ─────
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
