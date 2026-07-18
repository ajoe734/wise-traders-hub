/**
 * instrument 欄位（DB `expert_signals.instrument`、`trade_records.instrument` 等）
 * 儲存格式為「代號 名稱」，例如：
 *   - "2330 台積電"
 *   - "00631L 元大台灣50正2"
 *   - "00878B 國泰永續高股息"
 *   - "AAPL Apple Inc."
 *   - "BRK.B Berkshire Hathaway B"
 *
 * ETF 字尾（L 正 / R 反 / B 債券 / 中英混合）容易被 `/^\d+/` 或 `/\d{4,6}/`
 * 這類舊 regex 吃掉最後一個字母，導致代號被截成 5 碼。
 *
 * 統一在這裡處理，禁止在展示層自己 split(' ')/match(/^\d+/)。
 */

// 台股：4-6 位數字 + 可選 1 個大寫英文字母（涵蓋 ETF 槓桿 L / 反向 R / 債券 B）
const TW_CODE_RE = /^\d{4,6}[A-Z]?/;
// 美股：1-5 個大寫英文字母 + 可選 .X 後綴（BRK.B、BF.B 等）
const US_CODE_RE = /^[A-Z]{1,5}(?:\.[A-Z])?/;
// 美股選擇權：OCC 21 字元格式（Root 1-6 + YYMMDD + C/P + 8 位履約價）
const US_OPTION_CODE_RE = /^[A-Z.]{1,6}\d{6}[CP]\d{8}/;
// 美股期貨：/ + 1-3 大寫 + 可選月碼 + 可選 1-2 位年碼
const US_FUTURE_CODE_RE = /^\/[A-Z0-9]{1,3}[FGHJKMNQUVXZ]?\d{0,2}/;

export interface ParsedInstrument {
  code: string;
  name: string;
}

/**
 * 從 instrument 拆出代號 + 名稱。
 * - "00631L 元大台灣50正2"          → { code: "00631L", name: "元大台灣50正2" }
 * - "AAPL Apple"                    → { code: "AAPL",   name: "Apple" }
 * - "AAPL240119C00150000 Apple C150" → { code: "AAPL240119C00150000", name: "Apple C150" }
 * - "/ES E-mini S&P"                → { code: "/ES",    name: "E-mini S&P" }
 * - null / ""                        → { code: "",      name: "" }
 * - "中文開頭"                       → { code: "",      name: "中文開頭" }
 *
 * 匹配順序：期貨（`/` 起首）→ 選擇權（含 C/P 中段）→ 台股（純數字）→ 美股（純字母）
 * 這個順序很重要：US_CODE_RE 會吃掉 "AAPL240119..." 前 5 個字母。
 */
export function parseInstrument(raw?: string | null): ParsedInstrument {
  const s = String(raw ?? '').trim();
  if (!s) return { code: '', name: '' };
  const m =
    s.match(US_FUTURE_CODE_RE) ||
    s.match(US_OPTION_CODE_RE) ||
    s.match(TW_CODE_RE) ||
    s.match(US_CODE_RE);
  if (!m) return { code: '', name: s };
  const code = m[0];
  const name = s.slice(code.length).trim();
  return { code, name };
}

/**
 * 產生「代號 名稱」顯示字串。若名稱不明，只顯示代號；若代號也不明，保留原字串。
 */
export function formatInstrument(raw?: string | null, nameFallback?: string | null): string {
  const { code, name } = parseInstrument(raw);
  const resolvedName = (name || (nameFallback ?? '')).trim();
  if (code && resolvedName) return `${code} ${resolvedName}`;
  if (code) return code;
  return resolvedName || String(raw ?? '').trim();
}

/**
 * 從 instrument 取出純代號（含 ETF 字尾）。給查詢用（`stock_names.symbol`、
 * `current_prices.symbol` 等表都以完整代號為 PK，禁止截掉 L/R/B）。
 */
export function extractInstrumentCode(raw?: string | null): string {
  return parseInstrument(raw).code;
}
