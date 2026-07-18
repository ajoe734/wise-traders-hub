/**
 * SignalDetail 韌性欄位解析：instrument / price / quantity
 * ------------------------------------------------------
 * DB 欄位歷史上有 legacy 髒資料（空字串、null、字面 "NaN"、負值、非數字字串），
 * 直接 render 會導致 UI 顯示 "NaN"、"undefined" 或 toLocaleString 拋錯。
 * 這裡把「值 + 來源」一起回傳，畫面層可以：
 *   1. 拿到安全的 number/null，禁止直接 toLocaleString(null)
 *   2. 顯示來源標籤（Preview 模式除錯用）
 *   3. 對缺值走專屬 fallback，不進 ErrorBoundary
 */
import { parseInstrument } from './instrument';

// ---------------- Instrument ----------------

export type InstrumentMarket = 'tw-stock' | 'us-stock' | 'us-option' | 'us-future' | 'unknown';
export type InstrumentSource = 'parsed' | 'code-only' | 'name-only' | 'raw-only' | 'missing';

export interface ResolvedInstrument {
  code: string;
  name: string;
  market: InstrumentMarket;
  source: InstrumentSource;
  /** 給畫面顯示：優先「代號 名稱」，退到代號、名稱、"—" */
  display: string;
  /** 原始字串（trim 後） */
  raw: string;
}

export const INSTRUMENT_MARKET_LABEL: Record<InstrumentMarket, string> = {
  'tw-stock': '台股',
  'us-stock': '美股',
  'us-option': '美股選擇權',
  'us-future': '美股期貨',
  'unknown': '未知',
};

export const INSTRUMENT_SOURCE_LABEL: Record<InstrumentSource, string> = {
  parsed: '完整解析',
  'code-only': '僅代號',
  'name-only': '僅名稱',
  'raw-only': '原始字串',
  missing: '缺失',
};

const TW_CODE_ONLY_RE = /^\d{4,6}[A-Z]?$/;
const US_OPTION_CODE_ONLY_RE = /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/;
const US_FUTURE_CODE_ONLY_RE = /^\/[A-Z0-9]{1,3}[FGHJKMNQUVXZ]?\d{0,2}$/;
const US_CODE_ONLY_RE = /^[A-Z]{1,5}(?:\.[A-Z])?$/;

function inferMarket(code: string): InstrumentMarket {
  if (!code) return 'unknown';
  if (US_FUTURE_CODE_ONLY_RE.test(code)) return 'us-future';
  if (US_OPTION_CODE_ONLY_RE.test(code)) return 'us-option';
  if (TW_CODE_ONLY_RE.test(code)) return 'tw-stock';
  if (US_CODE_ONLY_RE.test(code)) return 'us-stock';
  return 'unknown';
}

export function resolveInstrument(raw?: string | null): ResolvedInstrument {
  const s = String(raw ?? '').trim();
  if (!s) {
    return { code: '', name: '', market: 'unknown', source: 'missing', display: '—', raw: '' };
  }
  const { code, name } = parseInstrument(s);
  const market = inferMarket(code);
  let source: InstrumentSource;
  if (code && name) source = 'parsed';
  else if (code) source = 'code-only';
  else if (name) source = 'name-only';
  else source = 'raw-only';

  const display =
    code && name ? `${code} ${name}` : code || name || s;

  return { code, name, market, source, display, raw: s };
}

// ---------------- Numeric (price / quantity) ----------------

export type NumericSource = 'explicit' | 'coerced-string' | 'invalid' | 'missing';

export interface ResolvedNumeric {
  value: number | null;
  source: NumericSource;
  /** 原始輸入的 typeof（除錯用） */
  rawType: string;
}

export const NUMERIC_SOURCE_LABEL: Record<NumericSource, string> = {
  explicit: '正常數值',
  'coerced-string': '字串轉數值',
  invalid: '無效值',
  missing: '缺失',
};

export interface ResolveNumericOptions {
  /** 允許 0（預設 true）；quantity 業務上可能允許 0 也可能不允許，由呼叫端決定 */
  allowZero?: boolean;
  /** 允許負值（預設 false：price/quantity 都不該是負） */
  allowNegative?: boolean;
}

export function resolveNumeric(
  raw: unknown,
  options: ResolveNumericOptions = {},
): ResolvedNumeric {
  const { allowZero = true, allowNegative = false } = options;
  const rawType = raw === null ? 'null' : typeof raw;

  if (raw === null || raw === undefined || raw === '') {
    return { value: null, source: 'missing', rawType };
  }

  let n: number;
  let source: NumericSource;
  if (typeof raw === 'number') {
    n = raw;
    source = 'explicit';
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { value: null, source: 'missing', rawType };
    n = Number(trimmed);
    source = 'coerced-string';
  } else {
    return { value: null, source: 'invalid', rawType };
  }

  if (!Number.isFinite(n)) return { value: null, source: 'invalid', rawType };
  if (!allowZero && n === 0) return { value: null, source: 'invalid', rawType };
  if (!allowNegative && n < 0) return { value: null, source: 'invalid', rawType };

  return { value: n, source, rawType };
}

/**
 * price × quantity → total，任一為 null 就回 null，避免 NaN 溢出下游 FX 元件。
 */
export function safeMultiply(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  const r = a * b;
  return Number.isFinite(r) ? r : null;
}
