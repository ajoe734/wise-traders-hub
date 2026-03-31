import { MARKET_TIMEZONE } from '../constants.js'

export function todayStorageDate() {
  return new Date().toISOString().slice(0, 10)
}

export function parseStoredDate(value) {
  if (!value || typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function toSlashDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

export function parseSlashDate(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  )
    return null
  date.setHours(0, 0, 0, 0)
  return date
}

export function parseFlexibleDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value)
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const raw = String(value).trim()
  if (!raw) return null
  const slashDate = parseSlashDate(raw)
  if (slashDate) return slashDate
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDate) {
    const date = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function daysSince(value, now = new Date()) {
  const parsed = parseFlexibleDate(value)
  if (!parsed) return null
  const current = now instanceof Date ? new Date(now) : parseFlexibleDate(now)
  if (!current) return null
  parsed.setHours(0, 0, 0, 0)
  current.setHours(0, 0, 0, 0)
  return Math.round((current - parsed) / (1000 * 60 * 60 * 24))
}

export function computeStaleness(
  value,
  thresholdDays,
  { missingWhenEmpty = true, now = new Date() } = {}
) {
  if (value == null || value === '') return missingWhenEmpty ? 'missing' : 'stale'
  const age = daysSince(value, now)
  if (age == null) return 'missing'
  return age <= thresholdDays ? 'fresh' : 'stale'
}

export function getTaipeiClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date)
  const info = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  )
  const hour = Number(info.hour || 0)
  const minute = Number(info.minute || 0)
  return {
    marketDate: `${info.year}-${info.month}-${info.day}`,
    weekday: info.weekday || '',
    hour,
    minute,
    minutes: hour * 60 + minute,
    isWeekend: info.weekday === 'Sat' || info.weekday === 'Sun',
  }
}

export async function fetchJsonWithTimeout(input, init = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json().catch((err) => {
      console.warn(`JSON parse error from ${input}:`, err)
      return {}
    })
    return { response, data }
  } finally {
    clearTimeout(timer)
  }
}

export function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
