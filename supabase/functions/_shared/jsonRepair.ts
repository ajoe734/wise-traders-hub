// deno-lint-ignore-file
/**
 * Shared JSON array parsing/repair utilities for AI responses.
 * AI models often emit JSON wrapped in markdown fences, with prose,
 * or truncated mid-array when the token budget is hit. This module
 * provides a single robust parser used by checkup-calendar and
 * checkup-predict-events.
 */

function stripFences(text: string): string {
  return String(text || "")
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/'''(?:json)?\s*/gi, "")
    .replace(/'''\s*/g, "");
}

/** Find the outermost balanced [...] block. */
function extractBalancedArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

/** Last-resort: walk top-level objects inside an unclosed array. */
function repairTruncatedArray(text: string): any[] | null {
  const arrStart = text.indexOf("[");
  if (arrStart === -1) return null;
  const sub = text.substring(arrStart);

  const lastClose = sub.lastIndexOf("}");
  if (lastClose !== -1) {
    const candidate = sub.substring(0, lastClose + 1) + "]";
    const trimmed = candidate.replace(/,\s*\]$/, "]");
    for (const c of [candidate, trimmed]) {
      try {
        const parsed = JSON.parse(c);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* ignore */ }
    }
  }

  const items: any[] = [];
  let i = arrStart + 1;
  while (i < sub.length) {
    while (i < sub.length && sub[i] !== "{") i++;
    if (i >= sub.length) break;
    const objStart = i;
    let depth = 0, inStr = false, esc = false;
    for (; i < sub.length; i++) {
      const ch = sub[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { items.push(JSON.parse(sub.substring(objStart, i + 1))); } catch { /* skip */ }
          i++;
          break;
        }
      }
    }
    if (depth !== 0) break;
  }
  return items.length > 0 ? items : null;
}

/**
 * Parse a JSON array from arbitrary AI response text.
 * Returns the parsed array (possibly empty), or null if parsing failed.
 */
export function parseJsonArray(text: string): any[] | null {
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }

  const cleaned = stripFences(text);
  const block = extractBalancedArray(cleaned);
  if (block) {
    try {
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }

  if (cleaned !== text) {
    const blockRaw = extractBalancedArray(text);
    if (blockRaw && blockRaw !== block) {
      try {
        const parsed = JSON.parse(blockRaw);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* ignore */ }
    }
  }

  const repaired = repairTruncatedArray(cleaned);
  if (repaired) {
    console.log(`[jsonRepair] recovered ${repaired.length} items from truncated array`);
    return repaired;
  }
  return null;
}
