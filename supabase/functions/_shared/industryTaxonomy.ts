/**
 * industryTaxonomy（Deno 鏡像）
 * 字典唯一來源：`supabase/functions/_shared/industryTaxonomy.json`
 * 與 `src/checkup/data/industryTaxonomy.json` 由 contract test 鎖定 byte-equal。
 */
import taxonomyJson from './industryTaxonomy.json' with { type: 'json' }

const RAW = taxonomyJson as unknown as {
  groups: Record<string, string[]>
  themes: string[]
  nonEquityMarkets: string[]
}

export const INDUSTRY_GROUPS = RAW.groups
export const THEMES = RAW.themes
export const NON_EQUITY_MARKETS = RAW.nonEquityMarkets
export const INDUSTRIES: string[] = Object.values(INDUSTRY_GROUPS).flat()

const INDUSTRY_SET = new Set(INDUSTRIES)
const THEME_SET = new Set(THEMES)

export function isValidIndustry(name: unknown): boolean {
  return typeof name === 'string' && INDUSTRY_SET.has(name)
}

export function isValidTheme(name: unknown): boolean {
  return typeof name === 'string' && THEME_SET.has(name)
}

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
  if (/^00\d{2,4}[A-Z]?$/.test(sym)) return true
  if (/^\d{5}[A-Z]$/.test(sym)) return true
  return false
}

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
  if (dedup.length !== uniq.length) return { industries: uniq, revenueMix: null }

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
