/**
 * industryTaxonomy — 細分產業／題材字典（前台純函式層）
 *
 * 唯一字典來源：`src/checkup/data/industryTaxonomy.json`
 * Deno 端鏡像：`supabase/functions/_shared/industryTaxonomy.ts`（由 contract test 鎖定一致）
 */
import taxonomyJson from '@/checkup/data/industryTaxonomy.json'

export type TaxonomyGroups = Record<string, string[]>

const RAW = taxonomyJson as unknown as {
  groups: TaxonomyGroups
  themes: string[]
  nonEquityMarkets: string[]
}

export const INDUSTRY_GROUPS: TaxonomyGroups = RAW.groups
export const THEMES: string[] = RAW.themes
export const NON_EQUITY_MARKETS: string[] = RAW.nonEquityMarkets

export const INDUSTRIES: string[] = Object.values(INDUSTRY_GROUPS).flat()

const INDUSTRY_SET = new Set(INDUSTRIES)
const THEME_SET = new Set(THEMES)

const GROUP_OF: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [group, list] of Object.entries(INDUSTRY_GROUPS)) {
    for (const ind of list) out[ind] = group
  }
  return out
})()

export function isValidIndustry(name: unknown): boolean {
  return typeof name === 'string' && INDUSTRY_SET.has(name)
}

export function isValidTheme(name: unknown): boolean {
  return typeof name === 'string' && THEME_SET.has(name)
}

export function groupOfIndustry(name: string): string | null {
  return GROUP_OF[name] || null
}

/** 非個股（ETF / ETN / DR / 受益證券…）不進分類流程 */
export function isNonEquity(input: {
  symbol?: string | null
  officialIndustry?: string | null
  name?: string | null
}): boolean {
  const ind = (input.officialIndustry || '').trim()
  if (ind && NON_EQUITY_MARKETS.some((m) => ind.includes(m))) return true
  const name = (input.name || '').trim()
  if (/ETF|ETN|購\d{2}|售\d{2}/i.test(name)) return true
  const sym = String(input.symbol || '').trim()
  // 台股 ETF 代號：00 開頭（0050、00878、00631L…）；權證為 6 碼英數
  if (/^00\d{2,4}[A-Z]?$/.test(sym)) return true
  if (/^\d{5}[A-Z]$/.test(sym)) return true
  return false
}

/** 只保留字典內的細分產業，並依比重降冪正規化 */
export function sanitizeIndustries(
  industries: unknown,
  revenueMix?: unknown,
): { industries: string[]; revenueMix: Array<{ industry: string; pct: number }> | null } {
  const list = Array.isArray(industries) ? industries.filter(isValidIndustry).map(String) : []
  const uniq = Array.from(new Set(list)).slice(0, 3)
  if (uniq.length === 0) return { industries: [], revenueMix: null }

  const mixRaw = Array.isArray(revenueMix) ? revenueMix : []
  const mix = mixRaw
    .map((m) => {
      const row = m as { industry?: unknown; pct?: unknown }
      return { industry: String(row?.industry ?? ''), pct: Number(row?.pct) }
    })
    .filter((m) => uniq.includes(m.industry) && Number.isFinite(m.pct) && m.pct > 0)

  const seen = new Set<string>()
  const dedup = mix.filter((m) => (seen.has(m.industry) ? false : (seen.add(m.industry), true)))

  if (dedup.length !== uniq.length) {
    return { industries: uniq, revenueMix: null }
  }
  const total = dedup.reduce((s, m) => s + m.pct, 0)
  if (total <= 0) return { industries: uniq, revenueMix: null }
  const normalized = dedup
    .map((m) => ({ industry: m.industry, pct: (m.pct / total) * 100 }))
    .sort((a, b) => b.pct - a.pct)
  return { industries: normalized.map((m) => m.industry), revenueMix: normalized }
}

export function sanitizeThemes(themes: unknown): string[] {
  const list = Array.isArray(themes) ? themes.filter(isValidTheme).map(String) : []
  return Array.from(new Set(list)).slice(0, 5)
}
