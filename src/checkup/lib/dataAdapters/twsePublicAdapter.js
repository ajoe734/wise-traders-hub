/**
 * TWSE Public Data Adapter — wraps free TWSE/MOPS API proxies
 * into the unified data adapter interface.
 *
 * Data sources:
 *   /api/twse         — 即時股價 (mis.twse.com.tw)
 *   /api/twse-institutional — 三大法人買賣超 (T86)
 *   /api/mops-revenue  — 月營收 (mops.twse.com.tw)
 *   /api/mops-announcements — 重大訊息
 */
import { createEmptyCompanyData } from './types.js'

/**
 * Fetch real-time quotes for one or more stock codes.
 * @param {string[]} codes — e.g. ['2330', '2454']
 * @returns {Promise<Record<string, {price:number, change:number, changePct:number, volume:number}>>}
 */
export async function fetchQuotes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return {}

  const exCh = codes.map((code) => `tse_${code}.tw`).join('|')
  const res = await fetch(`/api/twse?ex_ch=${encodeURIComponent(exCh)}`)
  if (!res.ok) throw new Error(`TWSE quotes failed: ${res.status}`)

  const data = await res.json()
  const items = data?.msgArray || []
  const result = {}

  for (const item of items) {
    const code = item.c
    const price = parseFloat(item.z) || parseFloat(item.y) || 0
    const yesterday = parseFloat(item.y) || 0
    const change = yesterday > 0 ? price - yesterday : 0
    const changePct = yesterday > 0 ? (change / yesterday) * 100 : 0
    const volume = parseInt(item.v, 10) || 0

    result[code] = { price, change, changePct, volume }
  }

  return result
}

/**
 * Fetch institutional trading data for a given date.
 * @param {string} date — YYYYMMDD format
 * @returns {Promise<Record<string, {foreign:number, investment:number, dealer:number, total:number}>>}
 */
export async function fetchInstitutional(date) {
  const res = await fetch(`/api/twse-institutional?date=${date}`)
  if (!res.ok) throw new Error(`TWSE institutional failed: ${res.status}`)

  const data = await res.json()
  const rows = data?.data || []
  const result = {}

  for (const row of rows) {
    const code = String(row.code || '').trim()
    if (!code) continue
    result[code] = {
      foreign: row.foreign ?? 0,
      investment: row.investment ?? 0,
      dealer: row.dealer ?? 0,
      total: row.total ?? 0,
    }
  }

  return result
}

/**
 * Fetch monthly revenue for a stock.
 * @param {string} stockId — e.g. '2330'
 * @param {number} year — e.g. 2026
 * @param {number} month — e.g. 3
 * @returns {Promise<{revenueMonth:string, revenue:number, revenueYoY:number, revenueMoM:number}|null>}
 */
export async function fetchMonthlyRevenue(stockId, year, month) {
  const res = await fetch(`/api/mops-revenue?stockId=${stockId}&year=${year}&month=${month}`)
  if (!res.ok) return null

  const data = await res.json()
  if (!data || data.error) return null

  return {
    revenueMonth: `${year}/${String(month).padStart(2, '0')}`,
    revenue: data.revenue ?? 0,
    revenueYoY: data.yoy ?? 0,
    revenueMoM: data.mom ?? 0,
  }
}

/**
 * Fetch MOPS announcements (重大訊息).
 * @param {string} date — YYYY-MM-DD format
 * @returns {Promise<Array<{code:string, name:string, title:string, date:string, type:string}>>}
 */
export async function fetchAnnouncements(date) {
  const res = await fetch(`/api/mops-announcements?date=${date}`)
  if (!res.ok) return []

  const data = await res.json()
  return Array.isArray(data?.announcements) ? data.announcements : []
}

/**
 * Build a CompanyData object from TWSE public sources.
 * Combines quote + revenue data into the unified shape.
 * @param {string} code
 * @returns {Promise<object>} CompanyData
 */
export async function fetchCompanyData(code) {
  const company = createEmptyCompanyData(code)
  company.source = 'twse-public'
  company.freshness = 'fresh'
  company.fetchedAt = new Date().toISOString()

  const now = new Date()
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()

  try {
    const revenue = await fetchMonthlyRevenue(code, prevYear, prevMonth)
    if (revenue) {
      company.revenueYoy = revenue.revenueYoY
    }
  } catch {
    // revenue fetch is best-effort
  }

  return company
}
