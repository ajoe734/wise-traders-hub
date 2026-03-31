/**
 * Data adapter types — unified shapes for company, supply-chain, and theme data.
 *
 * Every factory returns a plain object with sensible defaults so consumers
 * never have to null-check structural fields.
 */

/**
 * Create an empty CompanyData object with sensible defaults.
 * @param {string} code — stock code, e.g. "2308"
 * @returns {object}
 */
export function createEmptyCompanyData(code) {
  return {
    code,
    name: '',
    sector: '',
    industry: '',
    pe: null,
    forwardPe: null,
    pb: null,
    ps: null,
    evEbitda: null,
    revenueYoy: null,
    epsGrowth: null,
    grossMargin: null,
    operatingMargin: null,
    source: '',
    freshness: 'missing',
    fetchedAt: null,
  }
}

/**
 * Create an empty SupplyChain object.
 * @param {string} code — stock code
 * @returns {object}
 */
export function createEmptySupplyChain(code) {
  return {
    code,
    name: '',
    upstream: [],
    downstream: [],
    customers: [],
    suppliers: [],
    source: '',
  }
}

/**
 * Create an empty Theme object.
 * @param {string} name — theme name, e.g. "AI伺服器"
 * @returns {object}
 */
export function createEmptyTheme(name) {
  return {
    name,
    description: '',
    count: 0,
    relatedThemes: [],
    stocks: { upstream: [], midstream: [], downstream: [] },
    source: '',
  }
}

/**
 * Merge multiple CompanyData objects. First non-null / non-empty value wins
 * for each field.  Typically used to layer static profile data, cached API
 * data, and fresh API data together.
 *
 * @param  {...object} sources — CompanyData objects, highest-priority first
 * @returns {object} merged CompanyData
 */
export function mergeCompanyData(...sources) {
  if (sources.length === 0) return createEmptyCompanyData('')

  const base = createEmptyCompanyData(sources[0]?.code ?? '')
  const keys = Object.keys(base)

  for (const key of keys) {
    for (const src of sources) {
      if (!src) continue
      const val = src[key]
      if (val !== null && val !== undefined && val !== '') {
        base[key] = val
        break
      }
    }
  }

  return base
}
