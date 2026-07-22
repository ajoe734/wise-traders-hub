/**
 * 多幣別共用工具（experts.currency）
 *
 * 設計原則：
 * - 每位 expert 綁一個 currency（TWD / USD），不做匯率折算。
 * - 金額顯示前綴：TWD → `NT$`，USD → `US$`。
 * - 美股代碼：英文 1–5 字母（可含 1 個 `.X` 後綴，如 BRK.B）。
 * - 台股代碼：4–6 位數字。
 * - 美股單位永遠是「股」；台股可選「張 / 股」。
 */

export type Currency = 'TWD' | 'USD';

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  TWD: 'NT$',
  USD: 'US$',
};

export const CURRENCY_LABEL: Record<Currency, string> = {
  TWD: '新台幣（台股）',
  USD: '美元（美股）',
};

export function normalizeCurrency(v: unknown): Currency {
  return v === 'USD' ? 'USD' : 'TWD';
}

/**
 * 從 instrument（可能是 "2330 台積電" / "AAPL Apple" / 純代碼）推斷幣別。
 * 找不到有效代碼時回傳 null，讓呼叫端決定要不要再 fallback。
 */
export function inferCurrencyFromInstrument(instrument: string | null | undefined): Currency | null {
  if (!instrument) return null;
  const first = instrument.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  if (!first) return null;
  if (TW_SYMBOL_RE.test(first)) return 'TWD';
  if (US_SYMBOL_RE.test(first)) return 'USD';
  return null;
}

/** 幣別解析來源，供前端診斷 & analytics 追蹤使用。 */
export type CurrencySource = 'explicit' | 'inferred-instrument' | 'default-fallback';

export const CURRENCY_SOURCE_LABEL: Record<CurrencySource, string> = {
  explicit: '教師設定',
  'inferred-instrument': '代號推斷',
  'default-fallback': '預設 TWD',
};

/**
 * 同 resolveDisplayCurrency，但同時回傳幣別來源，讓 UI 能顯示「由 experts 或 instrument 推斷」
 * 並在 analytics 事件中紀錄，方便日後除錯。
 */
export function resolveDisplayCurrencyWithSource(
  explicit: unknown,
  instrument: string | null | undefined,
): { currency: Currency; source: CurrencySource } {
  if (explicit === 'USD' || explicit === 'TWD') {
    return { currency: explicit, source: 'explicit' };
  }
  const inferred = inferCurrencyFromInstrument(instrument);
  if (inferred) return { currency: inferred, source: 'inferred-instrument' };
  return { currency: 'TWD', source: 'default-fallback' };
}

/**
 * SignalDetail / 週記顯示用：優先吃 experts.currency，缺值時從 instrument 推斷，
 * 都沒有才回落預設 TWD。確保即使教學欄位不完整頁面也不會壞。
 */
export function resolveDisplayCurrency(
  explicit: unknown,
  instrument: string | null | undefined,
): Currency {
  return resolveDisplayCurrencyWithSource(explicit, instrument).currency;
}


/** 金額顯示：取整數後加千分位 + 幣別符號。負數會把 `-` 移到符號前。 */
export function formatMoneyByCurrency(n: number | null | undefined, c: Currency = 'TWD'): string {
  const sym = CURRENCY_SYMBOL[c] || 'NT$';
  const num = n == null ? 0 : Number(n);
  if (!Number.isFinite(num)) return `${sym}0`;
  const v = Math.round(num);
  if (v < 0) return `-${sym}${Math.abs(v).toLocaleString()}`;
  return `${sym}${v.toLocaleString()}`;
}

/** 純小數顯示（不帶幣別符號），例如報價、單價。預設 2 位；可覆寫 digits（如 crypto 4 位）。 */
export function formatPriceByCurrency(n: number | null | undefined, c: Currency = 'TWD', digits?: number): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const d = digits != null ? digits : (c === 'USD' ? 2 : 2);
  return Number(n).toFixed(d);
}


const US_SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
// 台股：4–6 位數字 + 選填 1 個大寫英文字母（涵蓋槓桿 L / 反向 R / 債券 B 等 ETF）
const TW_SYMBOL_RE = /^\d{4,6}[A-Z]?$/;

export function isValidSymbol(code: string, c: Currency): boolean {
  const s = (code || '').trim().toUpperCase();
  if (!s) return false;
  return c === 'USD' ? US_SYMBOL_RE.test(s) : TW_SYMBOL_RE.test(s);
}

/** 給 placeholder / error message 用的範例代碼字串 */
export function symbolPlaceholder(c: Currency): string {
  return c === 'USD' ? '例：AAPL / TSLA' : '例：2330 / 00631L';
}

/** 允許的單位下拉選項 */
export function allowedQuantityUnits(c: Currency): Array<'張' | '股'> {
  // USD：無「張」概念，只允許「股」
  return c === 'USD' ? ['股'] : ['張', '股'];
}

/** 該幣別下，TradeDraft.quantityUnit 的預設值 */
export function defaultQuantityUnit(c: Currency): '張' | '股' {
  return c === 'USD' ? '股' : '張';
}

/**
 * @deprecated 顯示層請改用 `sanitizeAssetQuantityUnit(raw, asset_class)`（來自 `@/lib/asset`）。
 * 此函式只能輸出「張/股」，無法正確處理期貨（口）/選擇權（口）/加密（顆），
 * 已在 SignalDetail / JournalDetail 全數移除。保留僅供向後相容，未來版本會刪除。
 * - USD：一律回傳「股」
 * - TWD：raw 非張/股 一律預設「張」
 */
export function sanitizeQuantityUnit(raw: string | null | undefined, c: Currency): '張' | '股' {
  if (c === 'USD') return '股';
  const t = (raw || '').trim();
  if (t === '張' || t === '股') return t;
  return '張';
}

