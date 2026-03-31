import { MARKET_TIMEZONE, POST_CLOSE_SYNC_MINUTES } from '../constants.js'

export function parseStoredDate(value) {
  if (!value || typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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

  const slashDate = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (slashDate) {
    const date = new Date(Number(slashDate[1]), Number(slashDate[2]) - 1, Number(slashDate[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDate) {
    const date = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function todayStorageDate() {
  return new Date().toISOString().slice(0, 10)
}

export function formatDateToStorageDate(value) {
  const parsed = parseFlexibleDate(value)
  return parsed ? parsed.toISOString().slice(0, 10) : todayStorageDate()
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

export function canRunPostClosePriceSync(date = new Date(), syncMeta = null) {
  const clock = getTaipeiClock(date)
  if (clock.isWeekend) return { allowed: false, reason: 'market-closed', clock }
  if (clock.minutes < POST_CLOSE_SYNC_MINUTES)
    return { allowed: false, reason: 'before-close', clock }
  if (syncMeta?.marketDate === clock.marketDate && syncMeta?.status && syncMeta.status !== 'idle') {
    return { allowed: false, reason: 'already-synced', clock }
  }
  return { allowed: true, reason: 'ready', clock }
}

export function formatDateTW(value) {
  const date = value instanceof Date ? value : parseFlexibleDate(value)
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

export function formatDateMD(value) {
  const date = value instanceof Date ? value : parseFlexibleDate(value)
  if (!date) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}/${day}`
}

export function formatTime(value) {
  const date = value instanceof Date ? value : parseFlexibleDate(value)
  if (!date) return ''
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : parseFlexibleDate(value)
  if (!date) return ''
  return `${formatDateTW(date)} ${formatTime(date)}`
}

export function getRelativeTime(value, now = new Date()) {
  const date = parseFlexibleDate(value)
  if (!date) return ''

  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週前`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}個月前`
  return `${Math.floor(diffDays / 365)}年前`
}
