/** 櫃買「產業價值鏈資訊平台」introduce.php 頁面解析（純函式）。 */
export interface ParsedChainRow {
  symbol: string
  name: string
  chain: string
  chainCode: string
  subCode: string
  subItem: string
  tier: string | null
}

const unescape = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()

export function listChainCodes(indexHtml: string): string[] {
  return Array.from(new Set(Array.from(indexHtml.matchAll(/ic=([A-Z0-9]{4})/g), (m) => m[1]))).sort()
}

export function parseChainPage(html: string, chainCode: string): ParsedChainRow[] {
  const t = html.match(/<title>\s*產業價值鏈資訊平台\s*&gt;\s*(.*?)產業鏈簡介/)
  const chain = t ? unescape(t[1]) : chainCode
  const tiers: Record<string, string | null> = {}
  let tier: string | null = null
  for (const m of html.matchAll(/chain-title-panel">\s*(上游|中游|下游)|id="ic_link_([A-Z0-9]+)"/g)) {
    if (m[1]) tier = m[1]
    else tiers[m[2]] = tier
  }
  const out: ParsedChainRow[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<div id="companyList_([A-Z0-9]+)" title="([^"]*)"[^>]*>([\s\S]*?)<span class="company-number">/g)) {
    const [, subCode, title, body] = m
    if (seen.has(subCode)) continue
    seen.add(subCode)
    const symSeen = new Set<string>()
    for (const c of body.matchAll(/stk_code=(\d{4}\w*)"[^>]*title="([^"]*)"/g)) {
      if (symSeen.has(c[1])) continue
      symSeen.add(c[1])
      out.push({ symbol: c[1], name: unescape(c[2]), chain, chainCode, subCode, subItem: unescape(title), tier: tiers[subCode] ?? null })
    }
  }
  return out
}
