/**
 * Frontend JSON repair for AI responses.
 * Mirrors logic from supabase/functions/_shared/jsonRepair.ts.
 *
 * AI models often emit JSON wrapped in markdown fences, prefixed with prose,
 * or truncated mid-structure when token budget is hit. These helpers recover
 * partial data instead of letting the whole analysis fall back.
 */

function stripFences(text) {
  return String(text || '')
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
}

function extractBalanced(text, openCh, closeCh) {
  const start = text.indexOf(openCh)
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === openCh) depth++
    else if (ch === closeCh) {
      depth--
      if (depth === 0) return text.substring(start, i + 1)
    }
  }
  return null
}

/** Last-resort: walk top-level objects inside an unclosed array. */
function repairTruncatedArray(text) {
  const arrStart = text.indexOf('[')
  if (arrStart === -1) return null
  const sub = text.substring(arrStart)

  const lastClose = sub.lastIndexOf('}')
  if (lastClose !== -1) {
    const candidate = sub.substring(0, lastClose + 1) + ']'
    const trimmed = candidate.replace(/,\s*\]$/, ']')
    for (const c of [candidate, trimmed]) {
      try {
        const parsed = JSON.parse(c)
        if (Array.isArray(parsed)) return parsed
      } catch { /* ignore */ }
    }
  }

  const items = []
  let i = arrStart + 1
  while (i < sub.length) {
    while (i < sub.length && sub[i] !== '{') i++
    if (i >= sub.length) break
    const objStart = i
    let depth = 0
    let inStr = false
    let esc = false
    for (; i < sub.length; i++) {
      const ch = sub[i]
      if (esc) { esc = false; continue }
      if (ch === '\\' && inStr) { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try { items.push(JSON.parse(sub.substring(objStart, i + 1))) } catch { /* skip */ }
          i++
          break
        }
      }
    }
    if (depth !== 0) break
  }
  return items.length > 0 ? items : null
}

/**
 * Parse a JSON array from arbitrary AI response text.
 * Returns the parsed array (possibly empty), or null if parsing failed.
 */
export function parseJsonArray(text) {
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore */ }

  const cleaned = stripFences(text)
  const block = extractBalanced(cleaned, '[', ']')
  if (block) {
    try {
      const parsed = JSON.parse(block)
      if (Array.isArray(parsed)) return parsed
    } catch { /* ignore */ }
  }

  const repaired = repairTruncatedArray(cleaned)
  if (repaired) return repaired
  return null
}

/**
 * Parse a JSON object from arbitrary AI response text.
 * Returns the parsed object, or null if parsing failed.
 */
export function parseJsonObject(text) {
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch { /* ignore */ }

  const cleaned = stripFences(text)
  const block = extractBalanced(cleaned, '{', '}')
  if (block) {
    try {
      const parsed = JSON.parse(block)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* ignore */ }
  }
  return null
}
