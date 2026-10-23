/**
 * chainClassification — 櫃買「產業價值鏈資訊平台」成員 → 細分產業（純函式，前後端共用）
 *
 * 規則：
 *  - 只輸出 chainSourceMap 對照得到、且在字典內的細分產業；對不上的子項丟棄。
 *  - 對照後只有一個產業 X，且 X 等於主要經營業務判讀的主產業 → 自動上線。
 *  - X 只出現在次要業務、或完全不一致 → 衝突，留待審。
 *  - 對照到多個產業（多角化）→ 營收比重第一名落在其中才上線，否則留待審。
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

export function resolveChainClassification(input: {
  members: ChainMember[]
  current: string[] | null | undefined
  revenueMix?: Array<{ industry: string; pct: number }> | null
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
  const mix = (input.revenueMix ?? [])
    .filter(x => isValidIndustry(x.industry) && Number.isFinite(x.pct) && x.pct > 0)
    .sort((a, b) => b.pct - a.pct)
  const highest = mix[0]?.pct
  const leaders = new Set(mix.filter(x => x.pct === highest).map(x => x.industry))
  const top = leaders.size === 1 ? mix[0]?.industry : undefined
  if (top && set.includes(top)) {
    return { status: 'adopted', industry: top, chainIndustries: set, ...evidenceFor(top), reason: '多角化，依營收比重第一名' }
  }
  return { status: 'diversified', industry: null, chainIndustries: set, tier: null, evidence: null, reason: `平台跨${set.length}類（${set.join('、')}），缺營收比重` }
}
