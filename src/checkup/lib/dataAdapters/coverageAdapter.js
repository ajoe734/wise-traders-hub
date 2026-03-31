import supplyChainData from '../../data/supplyChain.json' with { type: 'json' }
import themesData from '../../data/themes.json' with { type: 'json' }
import companyProfiles from '../../data/companyProfiles.json' with { type: 'json' }
import { createEmptyCompanyData } from './types.js'

/**
 * Look up company data by stock code.
 * Returns a CompanyData object with source="coverage-static", or null if unknown.
 * @param {string} code
 * @returns {object|null}
 */
export function getCompanyData(code) {
  const profile = companyProfiles[code]
  if (!profile) return null

  const data = createEmptyCompanyData(code)
  data.name = profile.name ?? ''
  data.sector = profile.sector ?? ''
  data.industry = profile.industry ?? ''
  data.source = 'coverage-static'
  data.freshness = 'aging'
  return data
}

/**
 * Look up supply chain by stock code.
 * @param {string} code
 * @returns {object|null}
 */
export function getSupplyChain(code) {
  const entry = supplyChainData[code]
  if (!entry) return null

  return {
    code,
    name: entry.name ?? '',
    upstream: entry.upstream ?? [],
    downstream: entry.downstream ?? [],
    customers: entry.customers ?? [],
    suppliers: entry.suppliers ?? [],
    source: 'coverage-static',
  }
}

/**
 * Return the full themes data object.
 * @returns {object}
 */
export function getThemes() {
  return themesData
}

/**
 * Find all themes that contain a given stock code.
 * Checks upstream, midstream, and downstream arrays of each theme.
 * @param {string} code
 * @returns {Array<object>}
 */
export function getThemesForStock(code) {
  const results = []
  for (const [name, theme] of Object.entries(themesData)) {
    const stocks = theme.stocks ?? {}
    const all = [
      ...(stocks.upstream ?? []),
      ...(stocks.midstream ?? []),
      ...(stocks.downstream ?? []),
    ]
    if (all.includes(code)) {
      results.push({ name, ...theme })
    }
  }
  return results
}

/**
 * Get deduplicated array of all stock codes in a given theme.
 * @param {string} themeName
 * @returns {string[]}
 */
export function getStocksInTheme(themeName) {
  const theme = themesData[themeName]
  if (!theme) return []

  const stocks = theme.stocks ?? {}
  const all = [
    ...(stocks.upstream ?? []),
    ...(stocks.midstream ?? []),
    ...(stocks.downstream ?? []),
  ]
  return [...new Set(all)]
}

/**
 * Get the description string for a company.
 * @param {string} code
 * @returns {string|null}
 */
export function getCompanyDescription(code) {
  const profile = companyProfiles[code]
  return profile?.description ?? null
}

/**
 * Get the wikilinks array for a company.
 * @param {string} code
 * @returns {string[]}
 */
export function getCompanyWikilinks(code) {
  const profile = companyProfiles[code]
  return profile?.wikilinks ?? []
}
