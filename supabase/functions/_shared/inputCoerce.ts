// 與 src/checkup/lib/edgeCoerce.js 同步的後端版本（Deno）。
// 改動時請同步兩邊。

export function coerceStocksString(value: unknown): { value: unknown; changed: boolean } {
  if (value == null) return { value, changed: false };
  let arr: unknown[];
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    arr = value.split(/[、,;\n\r]+/);
  } else {
    return { value, changed: false };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    if (raw == null) continue;
    const s = String(raw).trim().replace(/\s+/g, ' ');
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  const next = out.join('、');
  return { value: next, changed: next !== value };
}

export function coerceStocksArray(value: unknown): { value: unknown; changed: boolean } {
  if (value == null) return { value, changed: false };
  let arr: unknown[];
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    arr = value.split(/[、,;\n\r]+/);
  } else {
    return { value, changed: false };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    if (raw == null) continue;
    const s = String(raw).trim().replace(/\s+/g, ' ');
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  const sameLen = Array.isArray(value) && (value as unknown[]).length === out.length;
  const sameAll = sameLen && out.every((v, i) => v === (value as unknown[])[i]);
  return { value: out, changed: !sameAll };
}

export const COERCERS: Record<string, (v: unknown) => { value: unknown; changed: boolean }> = {
  stocksString: coerceStocksString,
  stocksArray: coerceStocksArray,
};

export interface CoerceFix {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
}

export function applyCoercion(
  fields: Record<string, { coerce?: string; label?: string }>,
  source: any,
): { source: any; fixes: CoerceFix[] } {
  if (!source || typeof source !== 'object') return { source, fixes: [] };
  let next = source;
  const fixes: CoerceFix[] = [];
  for (const [key, spec] of Object.entries(fields || {})) {
    if (!spec?.coerce) continue;
    const fn = COERCERS[spec.coerce];
    if (!fn) continue;
    const original = source[key];
    if (original === undefined || original === null || original === '') continue;
    const { value: coerced, changed } = fn(original);
    if (changed) {
      if (next === source) next = { ...source };
      next[key] = coerced;
      fixes.push({ key, label: spec.label || key, before: original, after: coerced });
    } else if (Array.isArray(original) !== Array.isArray(coerced) || typeof original !== typeof coerced) {
      if (next === source) next = { ...source };
      next[key] = coerced;
    }
  }
  return { source: next, fixes };
}
