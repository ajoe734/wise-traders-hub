/**
 * chainClassification — 櫃買「產業價值鏈資訊平台」成員 → 細分產業（純函式，前後端共用）
 *
 * 規則：
 *  - 只輸出 chainSourceMap 對照得到、且在字典內的細分產業；對不上的子項丟棄。
 *  - 對照後只有一個產業 X，且 X 等於主要經營業務判讀的主產業 → 自動上線。
 *  - X 只出現在次要業務、或完全不一致 → 衝突，留待審。
 *  - 對照到多個產業（多角化）→ 依 dominantIndustry 主業權重公式：只採年報營收占比，
 *    同產業加總後第一名 ≥ 40% 且領先第二名 ≥ 10 個百分點，且落在平台產業內才上線。
 *  - 平台沒有這檔 → 來源沒有。
 */
export type ChainSourceMap = Record<string, { subItem: string; industry: string }>

export interface ChainMember {
  chain: string
  tier: string | null
  subCode: string
  subItem: string
}

export type ChainStatus = 'adopted' | 'conflict' | 'diversified' | 'unmapped' | 'no_source'

export interface ChainResolution {
  status: ChainStatus
  industry: string | null
  chainIndustries: string[]
  tier: string | null
  evidence: string | null
  reason: string
}

/** 年報產品對不上字典時的佔位前綴：參與排名但不能成為主業 */
export const UNMAPPED = '未對照:'
export const MIN_PRIMARY_SHARE = 40
export const MIN_PRIMARY_LEAD = 10

/** 主業權重公式：只採年報營收占比；同產業加總；總和需 0–100.5；第一名 ≥40% 且領先第二名 ≥10 點。 */
export function dominantIndustry(input: {
  revenueMix?: Array<{ industry: string; pct: number }> | null
  source?: string | null
  isValidIndustry: (n: string) => boolean
}): { industry: string | null; share: number | null; lead: number | null; reason: string } {
  if (input.source !== 'annual_report') return { industry: null, share: null, lead: null, reason: '缺年報營收占比' }
  const raw = input.revenueMix ?? []
  if (raw.some(x => !Number.isFinite(x?.pct) || x.pct < 0)) return { industry: null, share: null, lead: null, reason: '營收占比無效' }
  const sums = new Map<string, number>()
  let total = 0
  for (const x of raw) {
    total += x.pct
    if (x.pct > 0 && isFinite(x.pct) && (String(x.industry).startsWith(UNMAPPED) || input.isValidIndustry(x.industry))) sums.set(x.industry, (sums.get(x.industry) ?? 0) + x.pct)
  }
  if (total <= 0 || total > 100.5) return { industry: null, share: null, lead: null, reason: '營收占比總和無效' }
  const ranked = Array.from(sums.entries()).sort((a, b) => b[1] - a[1])
  if (ranked.length === 0) return { industry: null, share: null, lead: null, reason: '營收占比無字典內產業' }
  const [top, share] = ranked[0]
  const lead = share - (ranked[1]?.[1] ?? 0)
  if (top.startsWith(UNMAPPED)) return { industry: null, share, lead, reason: `年報最大產品「${top.slice(UNMAPPED.length)}」${share}%未對照字典` }
  if (share < MIN_PRIMARY_SHARE) return { industry: null, share, lead, reason: `最高占比${share}%未達${MIN_PRIMARY_SHARE}%` }
  if (lead < MIN_PRIMARY_LEAD) return { industry: null, share, lead, reason: `領先第二名${lead}點未達${MIN_PRIMARY_LEAD}點` }
  return { industry: top, share, lead, reason: `年報營收占比${share}%，領先${lead}點` }
}

export function resolveChainClassification(input: {
  members: ChainMember[]
  current: string[] | null | undefined
  revenueMix?: Array<{ industry: string; pct: number }> | null
  revenueMixSource?: string | null
  map: ChainSourceMap
  isValidIndustry: (n: string) => boolean
}): ChainResolution {
  const { members, map, isValidIndustry } = input
  const current = (input.current ?? []).filter(Boolean)
  if (members.length === 0) {
    return { status: 'no_source', industry: null, chainIndustries: [], tier: null, evidence: null, reason: '產業價值鏈平台未收錄' }
  }
  const mapped = members
    .map((m) => ({ m, industry: map[m.subCode]?.industry }))
    .filter((x): x is { m: ChainMember; industry: string } => !!x.industry && isValidIndustry(x.industry))
  const set = Array.from(new Set(mapped.map((x) => x.industry))).sort()
  if (set.length === 0) {
    return { status: 'unmapped', industry: null, chainIndustries: [], tier: null, evidence: null, reason: '所屬子項無對應細分產業' }
  }
  const evidenceFor = (ind: string) => {
    const hit = mapped.find((x) => x.industry === ind)?.m
    if (!hit) return { tier: null, evidence: null }
    return { tier: hit.tier, evidence: `產業價值鏈：${hit.chain}${hit.tier ? ' ' + hit.tier : ''} ${hit.subItem}` }
  }
  if (set.length === 1) {
    const x = set[0]
    if (current[0] === x) {
      return { status: 'adopted', industry: x, chainIndustries: set, ...evidenceFor(x), reason: '平台子項與主要經營業務一致' }
    }
    return {
      status: 'conflict', industry: null, chainIndustries: set, tier: null, evidence: null,
      reason: current.includes(x) ? `平台為${x}，主要經營業務判讀為次要業務` : `平台為${x}，主要經營業務判讀為${current[0] ?? '無'}`,
    }
  }
  const d = dominantIndustry({ revenueMix: input.revenueMix, source: input.revenueMixSource, isValidIndustry })
  if (d.industry && set.includes(d.industry)) {
    return { status: 'adopted', industry: d.industry, chainIndustries: set, ...evidenceFor(d.industry), reason: `多角化，${d.reason}` }
  }
  const why = d.industry ? `年報主業${d.industry}不在平台產業內` : d.reason
  return { status: 'diversified', industry: null, chainIndustries: set, tier: null, evidence: null, reason: `平台跨${set.length}類（${set.join('、')}），${why}` }
}
