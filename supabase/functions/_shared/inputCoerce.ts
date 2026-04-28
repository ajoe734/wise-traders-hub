// 與 src/checkup/lib/edgeCoerce.js 同步的後端版本（Deno）。
// 改動時請同步兩邊。後端沒有 localStorage，預設一律 keepFirst / 保留空白 / 不轉全半形，
// 呼叫端可以透過第二個參數覆寫。

export interface CoercePrefs {
  strategy: 'keepFirst' | 'keepLast';
  ignoreWhitespace: boolean;
  normalizeWidth: boolean;
}

export const COERCE_PREF_DEFAULTS: CoercePrefs = {
  strategy: 'keepFirst',
  ignoreWhitespace: false,
  normalizeWidth: false,
};

export interface CoerceResult {
  value: unknown;
  changed: boolean;
  removedDuplicates: number;
  duplicates: Array<{ item: string; count: number }>;
}

const SEP_RE = /[、,;\n\r|]+/;

function toHalfWidth(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[，、]/g, ',');
}

function normalizeItem(raw: unknown, opts: CoercePrefs): string {
  if (raw == null) return '';
  let s = String(raw);
  if (opts.normalizeWidth) s = toHalfWidth(s);
  s = s.trim().replace(/\s+/g, ' ');
  return s;
}

function dedupKey(s: string, opts: CoercePrefs): string {
  if (opts.ignoreWhitespace) return s.replace(/\s+/g, '').toLowerCase();
  return opts.normalizeWidth ? s.toLowerCase() : s;
}

function toRawArray(value: unknown): unknown[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(SEP_RE);
  return null;
}

function dedupeItems(rawArr: unknown[], opts: CoercePrefs) {
  const normalized: string[] = [];
  for (const raw of rawArr) {
    const s = normalizeItem(raw, opts);
    if (!s) continue;
    normalized.push(s);
  }
  const counts = new Map<string, number>();
  const firstIdx = new Map<string, number>();
  const lastIdx = new Map<string, number>();
  for (let i = 0; i < normalized.length; i += 1) {
    const k = dedupKey(normalized[i], opts);
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!firstIdx.has(k)) firstIdx.set(k, i);
    lastIdx.set(k, i);
  }
  const keepIdx = opts.strategy === 'keepLast' ? lastIdx : firstIdx;
  const seen = new Set<string>();
  const items: string[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const k = dedupKey(normalized[i], opts);
    if (seen.has(k)) continue;
    if (keepIdx.get(k) === i) {
      items.push(normalized[i]);
      seen.add(k);
    }
  }
  const duplicates: Array<{ item: string; count: number }> = [];
  for (const [k, count] of counts.entries()) {
    if (count > 1) {
      const idx = keepIdx.get(k)!;
      duplicates.push({ item: normalized[idx], count });
    }
  }
  return { items, removedDuplicates: normalized.length - items.length, duplicates };
}

export function coerceStocksString(value: unknown, prefs?: Partial<CoercePrefs>): CoerceResult {
  const arr = toRawArray(value);
  if (arr == null) return { value, changed: false, removedDuplicates: 0, duplicates: [] };
  const opts = { ...COERCE_PREF_DEFAULTS, ...(prefs || {}) };
  const { items, removedDuplicates, duplicates } = dedupeItems(arr, opts);
  const next = items.join('、');
  return { value: next, changed: next !== value, removedDuplicates, duplicates };
}

export function coerceStocksArray(value: unknown, prefs?: Partial<CoercePrefs>): CoerceResult {
  const arr = toRawArray(value);
  if (arr == null) return { value, changed: false, removedDuplicates: 0, duplicates: [] };
  const opts = { ...COERCE_PREF_DEFAULTS, ...(prefs || {}) };
  const { items, removedDuplicates, duplicates } = dedupeItems(arr, opts);
  const sameLen = Array.isArray(value) && (value as unknown[]).length === items.length;
  const sameAll = sameLen && items.every((v, i) => v === (value as unknown[])[i]);
  return { value: items, changed: !sameAll, removedDuplicates, duplicates };
}

export function coerceHoldingsList(value: unknown, prefs?: Partial<CoercePrefs>): CoerceResult {
  return coerceStocksString(value, prefs);
}

export const COERCERS: Record<string, (v: unknown, prefs?: Partial<CoercePrefs>) => CoerceResult> = {
  stocksString: coerceStocksString,
  stocksArray: coerceStocksArray,
  holdingsList: coerceHoldingsList,
};

export interface CoerceFix {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
  removedDuplicates: number;
  duplicates: Array<{ item: string; count: number }>;
}

export function applyCoercion(
  fields: Record<string, { coerce?: string; label?: string }>,
  source: any,
  prefs?: Partial<CoercePrefs>,
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
    const { value: coerced, changed, removedDuplicates, duplicates } = fn(original, prefs);
    if (changed) {
      if (next === source) next = { ...source };
      next[key] = coerced;
      fixes.push({ key, label: spec.label || key, before: original, after: coerced, removedDuplicates, duplicates });
    } else if (Array.isArray(original) !== Array.isArray(coerced) || typeof original !== typeof coerced) {
      if (next === source) next = { ...source };
      next[key] = coerced;
    }
  }
  return { source: next, fixes };
}
